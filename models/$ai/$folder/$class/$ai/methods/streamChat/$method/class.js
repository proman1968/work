import * as https from 'node:https';

/**
 * streamChat — стриминговый чат с поддержкой function calling.
 *
 * Режимы:
 * 1. Без functions — yield строк (токены content), обратная совместимость
 * 2. С functions — yield объектов {type, content?, name?, arguments?}
 *
 * Формат SSE function_call (OpenAI-compatible, GigaChat):
 *   delta.tool_calls[].function.{name, arguments}
 *   GigaChat часто отдаёт arguments уже объектом — не делать += в строку.
 */

/**
 * Накопить arguments FC: string-чанки склеиваются, object → JSON (GigaChat).
 * @param {string} acc
 * @param {unknown} value
 * @returns {string}
 */
export function appendFunctionArgs(acc, value) {
    if (value == null || value === '')
        return acc || '';
    if (typeof value === 'object') {
        let next = '';
        try {
            next = JSON.stringify(value);
        } catch {
            return acc || '';
        }
        if (!acc)
            return next;
        try {
            const base = JSON.parse(acc);
            if (base && typeof base === 'object' && !Array.isArray(base))
                return JSON.stringify(Object.assign({}, base, value));
        } catch {}
        return next;
    }
    return (acc || '') + String(value);
}

/**
 * Разобрать накопленные arguments; мусор "[object Object]" → {}.
 * @param {string|object} acc
 * @returns {object}
 */
export function parseFunctionArgs(acc) {
    if (acc == null || acc === '')
        return {};
    if (typeof acc === 'object' && !Array.isArray(acc))
        return sanitizeParsedArgs(acc);
    const s = String(acc);
    if (s === '[object Object]')
        return {};
    try {
        return sanitizeParsedArgs(JSON.parse(s));
    } catch {
        return { raw: s };
    }
}

function sanitizeParsedArgs(parsed) {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        return {};
    if (parsed.raw === '[object Object]' && Object.keys(parsed).length === 1)
        return {};
    return parsed;
}

/**
 * OpenAI/z.ai tools[] из внутреннего списка functions (GigaChat-style schema).
 * @param {Array} functions
 * @returns {Array<{type:string,function:object}>}
 */
export function toOpenAiTools(functions) {
    if (!Array.isArray(functions)) return [];
    return functions.map(f => ({ type: 'function', function: f }));
}

/**
 * Нормализация messages для OpenAI/GLM: нет role:function, есть непустой user.
 * Legacy function → tool; orphan function_call на assistant снимается в tool_calls-пару при возможности.
 * @param {Array} messages
 * @returns {Array}
 */
export function normalizeOpenAiMessages(messages) {
    if (!Array.isArray(messages)) return [];
    const out = [];
    let toolSeq = 0;
    for (const m of messages) {
        if (!m || typeof m !== 'object') continue;
        if (m.role === 'function') {
            const id = m.tool_call_id || ('call_' + (m.name || 'fn') + '_' + (toolSeq++));
            // Предыдущий assistant с function_call → tool_calls
            const prev = out[out.length - 1];
            if (prev?.role === 'assistant' && prev.function_call && !prev.tool_calls) {
                const fc = prev.function_call;
                const args = typeof fc.arguments === 'string'
                    ? fc.arguments
                    : JSON.stringify(fc.arguments || {});
                prev.tool_calls = [{
                    id,
                    type: 'function',
                    function: { name: fc.name || m.name || 'unknown', arguments: args },
                }];
                delete prev.function_call;
                if (prev.content === '')
                    prev.content = null;
            }
            out.push({
                role: 'tool',
                tool_call_id: id,
                content: m.content == null ? '' : String(m.content),
            });
            continue;
        }
        out.push({ ...m });
    }
    const hasUser = out.some(m => m.role === 'user' && String(m.content || '').trim());
    if (!hasUser)
        out.push({ role: 'user', content: 'Продолжай.' });
    return out;
}

export default {
    async *execute(params = {}, post) {
        const ai = params.$ai || this;
        const options = typeof post === 'string' ? JSON.parse(post) : (post || params);
        const useFunctions = Array.isArray(options.functions) && options.functions.length > 0;
        const isGigachat = ai.protocol === 'gigachat';
        let messages = options.messages || [];
        if (!isGigachat)
            messages = normalizeOpenAiMessages(messages);

        const body = {
            model: options.model || ai.model || '',
            messages,
            max_tokens: Math.min(options.maxTokens || (ai.maxTokens && Number(ai.maxTokens)) || 4096, 131072),
            temperature: options.temperature ?? 0.7,
            stream: true,
        };
        if (options.stop)
            body.stop = options.stop;

        // Function calling: gigachat = legacy functions; openai/z.ai = tools
        if (useFunctions && ai.functionCalling === true) {
            if (isGigachat) {
                body.functions = options.functions;
                if (options.function_call)
                    body.function_call = options.function_call;
            } else {
                body.tools = toOpenAiTools(options.functions);
                body.tool_choice = options.tool_choice
                    || (options.function_call === 'none' ? 'none' : 'auto');
            }
        }

        const headers = await getAuthHeaders(ai);
        const url = new URL(ai.baseUrl);

        const res = await new Promise((resolve, reject) => {
            const req = https.request({
                hostname: url.hostname,
                port: url.port || 443,
                path: url.pathname + url.search,
                method: 'POST',
                agent: isGigachat ? new https.Agent({ rejectUnauthorized: false }) : undefined,
                headers,
            }, (res) => {
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    const chunks = [];
                    res.on('data', c => chunks.push(c));
                    res.on('end', () => {
                        reject(new Error('LLM ' + body.model + ' stream error ' + res.statusCode + ': ' + Buffer.concat(chunks).toString('utf-8')));
                    });
                    return;
                }
                resolve(res);
            });
            req.on('error', reject);
            req.write(JSON.stringify(body));
            req.end();
        });

        // Аккумулятор для function_call (если поддерживается)
        let funcCallName = '';
        let funcCallArgs = '';

        const flushFunctionCall = function* () {
            if (!funcCallName)
                return;
            const parsedArgs = parseFunctionArgs(funcCallArgs);
            yield {
                type: 'function_call',
                name: funcCallName,
                arguments: parsedArgs,
            };
            funcCallName = '';
            funcCallArgs = '';
        };

        for await (const chunk of res) {
            const text = Buffer.isBuffer(chunk) ? chunk.toString('utf-8') : String(chunk);
            const lines = text.split('\n');
            for (const line of lines) {
                if (!line.startsWith('data: '))
                    continue;
                const jsonStr = line.slice(6).trim();
                if (!jsonStr || jsonStr === '[DONE]')
                    continue;
                try {
                    const json = JSON.parse(jsonStr);
                    const delta = json.choices?.[0]?.delta || json.choices?.[0]?.message || {};

                    // Content (текст ответа)
                    const content = delta.content || delta.text;
                    if (content) {
                        if (useFunctions)
                            yield { type: 'content', content };
                        else
                            yield content;
                    }

                    // Function call (нативный)
                    if (delta.tool_calls) {
                        for (const tc of delta.tool_calls) {
                            if (tc.function?.name)
                                funcCallName = tc.function.name;
                            if (tc.function?.arguments != null)
                                funcCallArgs = appendFunctionArgs(funcCallArgs, tc.function.arguments);
                        }
                    }
                    // Старый формат function_call
                    if (delta.function_call) {
                        if (delta.function_call.name)
                            funcCallName = delta.function_call.name;
                        if (delta.function_call.arguments != null)
                            funcCallArgs = appendFunctionArgs(funcCallArgs, delta.function_call.arguments);
                    }

                    // Завершение — function_call | tool_calls | stop с накопленным именем
                    const finishReason = json.choices?.[0]?.finish_reason;
                    if (
                        finishReason === 'function_call'
                        || finishReason === 'tool_calls'
                        || (finishReason === 'stop' && funcCallName)
                    ) {
                        yield* flushFunctionCall();
                    }

                    // Usage (часто в финальном chunk GigaChat / OpenAI stream)
                    if (json.usage) {
                        const u = json.usage;
                        const promptTokens = Number(u.prompt_tokens ?? u.promptTokens ?? 0) || 0;
                        const completionTokens = Number(u.completion_tokens ?? u.completionTokens ?? 0) || 0;
                        const totalTokens = Number(u.total_tokens ?? u.totalTokens ?? (promptTokens + completionTokens)) || 0;
                        yield {
                            type: 'usage',
                            prompt_tokens: promptTokens,
                            completion_tokens: completionTokens,
                            total_tokens: totalTokens,
                        };
                    }
                }
                catch {}
            }
        }

        // Flush в конце стрима (finish_reason мог не прийти / потеряться на chunk boundary)
        if (useFunctions && funcCallName)
            yield* flushFunctionCall();
    },
};

async function getAuthHeaders(ai) {
    const headers = { 'Content-Type': 'application/json' };
    switch (ai.protocol) {
        case 'gigachat': {
            if (!ai.accessToken || ai.accessToken.expires_at <= Date.now())
                ai.accessToken = await gigachatAuth(ai);
            headers['Authorization'] = 'Bearer ' + ai.accessToken.access_token;
            break;
        }
        case 'anthropic': {
            headers['x-api-key'] = ai.apiKey;
            headers['anthropic-version'] = '2023-06-01';
            break;
        }
        case 'openai':
        default: {
            if (ai.apiKey)
                headers['Authorization'] = 'Bearer ' + ai.apiKey;
        }
    }
    return headers;
}

async function gigachatAuth(ai) {
    const url = new URL(ai.authUrl);
    return new Promise((resolve, reject) => {
        const req = https.request({
            hostname: url.hostname,
            port: url.port || 9443,
            path: url.pathname,
            method: 'POST',
            agent: new https.Agent({ rejectUnauthorized: false }),
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json',
                'RqUID': crypto.randomUUID(),
                'Authorization': 'Bearer ' + ai.token,
            },
        }, (res) => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                const body = Buffer.concat(chunks).toString('utf-8');
                if (res.statusCode >= 400)
                    console.warn('[gigachat-auth] error:', res.statusCode, body.slice(0, 200));
                try {
                    resolve(JSON.parse(body));
                }
                catch (e) {
                    reject(new Error('GigaChat auth parse error: ' + e.message));
                }
            });
        });
        req.on('error', reject);
        req.write('scope=' + ai.scope);
        req.end();
    });
}
