/**
 * $ai — прототип модели искусственного интеллекта.
 *
 * Объявлен внутри MODELS/$ai/$folder/$class/$ai/.
 * Наследуется всеми $ai внутри models/.
 *
 * METADATA — поля провайдера/модели.
 * streamChat — стриминговый чат на экземпляре модели (this = модель).
 * HTTPS — через WORK.https, локальный HTTP (Ollama) — через WORK.http
 * (DATA грузится как data: URL, top-level import node:* нельзя).
 *
 * this — экземпляр модели:
 *   protocol, baseUrl, authUrl, apiKey, token, scope, model, maxTokens,
 *   capabilities, functionCalling, accessToken
 */

const ERROR_BODY_MAX = 64 * 1024;        // F28: тело ошибки потока — хватит для диагностики
const SSE_LINE_MAX = 1024 * 1024;        // F28: незавершённая строка SSE (data-JSON много меньше)
const JSON_BODY_MAX = 16 * 1024 * 1024;  // F28: JSON-ответ (картинка b64 — мегабайты; чужой мусор — нет)

const REMOTE_BODY_MAX = 32 * 1024 * 1024; // R7 (8.35): бинарный ответ провайдера (WAV речи/распознавания)

export default {
    icon: 'carbon:machine-learning-model',
    form: 'editor',
    /** карточка модели для клиента: попадает в info, читается баром и usage-панелью */
    $public: {
        maxTokens: 4096,   // лимит контекста (usage / info)
        maxOutput: 4096,   // лимит ответа: не путать с maxTokens — иначе Qwen 262k уезжает в max_tokens и думает минутами
        capabilities: ['chat', 'stream'],
        effort: '',
    },
    METADATA: {
        STATIC: [{
            id: 'protocol',
            type: 'String',
            placeholder: 'openai | anthropic | gigachat | custom',
            required: true,
        }, {
            id: 'baseUrl',
            type: 'String',
            placeholder: 'https://ngw.devices.gigachat-api.ru/api/v2/chat/completions',
            required: true,
        }, {
            id: 'apiKey',
            type: 'String',
            placeholder: 'sk-...',
        }, {
            id: 'token',
            type: 'String',
            placeholder: 'Authorization key (GigaChat OAuth)',
            required: true,
        }, {
            id: 'authUrl',
            type: 'String',
            placeholder: 'https://ngw.devices.gigachat-api.ru/api/v2/oauth',
        }, {
            id: 'scope',
            type: 'String',
            placeholder: 'GIGACHAT_API_PERS',
        }, {
            id: 'model',
            type: 'String',
            placeholder: 'GigaChat-Pro',
            required: true,
        }, {
            id: 'maxTokens',
            type: 'Number',
            placeholder: '4096',
        }, {
            id: 'capabilities',
            type: 'String',
            placeholder: 'chat, stream, effort',
        }, {
            id: 'effort',
            type: 'String',
            placeholder: 'off | low | medium | high',
        }, {
            id: 'functionCalling',
            type: 'Boolean',
            placeholder: 'false',
        }, {
            id: 'trustLevel',
            type: 'Number',
            placeholder: '0',
        }],
    },

    /** Кэш access token для протоколов с OAuth */
    get accessToken() {
        return this._accessToken ?? null;
    },
    set accessToken(v) {
        this._accessToken = v;
    },

    /**
     * Модели на API провайдера (не дети /MODELS в WORK).
     * Ollama: GET {origin}/api/tags; OpenAI-совместимый: GET {origin}/v1/models.
     */
    async list_remote(params = {}) {
        const ai = params.$ai || this;
        const base = String(ai.baseUrl || ai.DATA?.baseUrl || '').trim();
        const where = ai.short || ai.path || ai.id || '?';
        if (!base)
            return { error: 'list_remote: нет baseUrl у ' + where };
        let origin;
        try {
            origin = new URL(base).origin;
        }
        catch {
            return { error: 'list_remote: некорректный baseUrl: ' + base };
        }
        const headers = await getAuthHeaders(ai);
        const tried = [];
        const urls = [origin + '/api/tags', origin + '/v1/models'];
        for (const url of urls) {
            tried.push(url);
            try {
                const data = await httpsGetJson(url, headers, ai);
                const models = normalizeRemoteModelIds(data);
                if (models.length)
                    return { source: url, baseUrl: base, models };
            }
            catch (e) {
                tried[tried.length - 1] = url + ' (' + String(e.message || e).slice(0, 80) + ')';
            }
        }
        return {
            error: 'list_remote: не удалось получить список у ' + where,
            baseUrl: base,
            tried,
        };
    },

    /**
     * Стриминговый чат с поддержкой function calling.
     * Единственная реализация транспорта (чанки от провайдера).
     * Обычный method (не async*): Reactor/babel-merge ломают AsyncGenerator на DATA;
     * возвращаем async generator изнутри.
     * @param {object} [params]
     * @param {string|object} [post]
     * @returns {AsyncGenerator}
     */
    streamChat(params = {}, post) {
        const ai = params.$ai || this;
        return (async function* () {
        const options = typeof post === 'string' ? JSON.parse(post) : (post || params);
        const isGigachat = ai.protocol === 'gigachat';
        // Нативные инструменты: options.tools (OpenAI-формат) — решает вызывающий;
        // legacy options.functions — только при ai.functionCalling === true.
        let tools = Array.isArray(options.tools) && options.tools.length ? options.tools : null;
        if (!tools && Array.isArray(options.functions) && options.functions.length && ai.functionCalling === true)
            tools = toOpenAiTools(options.functions);
        // protocol 'anthropic' — нативный Messages API (свой формат запроса и потока); остальные — OpenAI-совместимый чат
        const isAnthropic = ai.protocol === 'anthropic';
        let body;
        if (isAnthropic) {
            body = buildAnthropicRequest(ai, options, tools);
        }
        else {
            let messages = options.messages || [];
            messages = isGigachat ? toGigaChatMessages(messages) : normalizeOpenAiMessages(messages);

            body = {
                model: options.model || ai.model || '',
                messages,
                temperature: options.temperature ?? 0.7,
                stream: true,
            };
            const cap = Number(options.maxOutput);
            if (Number.isFinite(cap) && cap > 0)
                body.max_tokens = cap;
            if (options.stop)
                body.stop = options.stop;
            applyEffort(body, ai, options);
            if (!isGigachat)
                body.stream_options = { include_usage: true };

            if (tools) {
                if (isGigachat) {
                    const gigaFns = sanitizeGigaChatFunctions(tools.map(t => t.function || t));
                    body.functions = gigaFns;
                    body.messages = sanitizeGigaChatMessages(messages, gigaFns);
                    body.function_call = options.function_call || 'auto';
                } else {
                    body.tools = tools;
                    body.tool_choice = resolveOpenAiToolChoice(options);
                    if (options.parallel_tool_calls != null)
                        body.parallel_tool_calls = !!options.parallel_tool_calls;
                }
            }
        }

        const isLocalNode = ai.protocol === 'local' || String(ai.path || ai.short || '').startsWith('/MODELS/Local/');
        const primaryFile = String(ai.primaryFile || ai.DATA?.primaryFile || '');
        if ((ai.protocol === 'local' || (isLocalNode && (!ai.baseUrl || primaryFile.endsWith('.safetensors')))) && typeof WORK?.localStreamChat === 'function') {
            yield* WORK.localStreamChat(ai, body, options);
            return;
        }

        const headers = await getAuthHeaders(ai);
        const url = new URL(isAnthropic ? anthropicUrl(ai.baseUrl) : ai.baseUrl);
        const transport = transportFor(url);

        const res = await new Promise((resolve, reject) => {
            const req = transport.request({
                hostname: url.hostname,
                port: url.port || (url.protocol === 'http:' ? 80 : 443),
                path: url.pathname + url.search,
                method: 'POST',
                agent: WORK.tls_agent?.(ai),
                headers,
            }, (res) => {
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    // F28: тело ошибки — с потолком (чужой сервер не решает, сколько мы держим в памяти)
                    const chunks = [];
                    let errSize = 0;
                    let overflow = false;
                    res.on('data', c => {
                        errSize += c.length;
                        if (errSize <= ERROR_BODY_MAX)
                            chunks.push(c);
                        else {
                            overflow = true;
                            res.destroy();
                        }
                    });
                    const text = () => Buffer.concat(chunks).toString('utf-8').slice(0, ERROR_BODY_MAX);
                    res.on('end', () => {
                        reject(new Error('LLM ' + body.model + ' stream error ' + res.statusCode + ': ' + text()
                            + (overflow ? ' (тело ошибки обрезано на ' + (ERROR_BODY_MAX / 1024) + ' КБ)' : '')));
                    });
                    res.on('error', () => {
                        reject(new Error('LLM ' + body.model + ' stream error ' + res.statusCode + ': ' + text()
                            + ' (соединение оборвано' + (overflow ? ' на потолке тела' : '') + ')'));
                    });
                    // destroy() без ошибки не всегда даёт 'error'/'end' — 'close' приходит всегда
                    res.on('close', () => {
                        if (overflow)
                            reject(new Error('LLM ' + body.model + ' stream error ' + res.statusCode + ': ' + text()
                                + ' (тело ошибки обрезано на ' + (ERROR_BODY_MAX / 1024) + ' КБ)'));
                    });
                    return;
                }
                resolve(res);
            });
            req.on('error', (err) => {
                if (isLocalNode && typeof WORK?.localStreamChat === 'function' && /ECONNREFUSED|ECONNRESET|ETIMEDOUT/i.test(String(err?.code || err?.message || ''))) {
                    resolve({ __localFallback: true });
                    return;
                }
                reject(err);
            });
            // Простой сокета (нет байтов) дольше idleMs — обрыв, а не вечное ожидание.
            // Локальным CPU-моделям (первый ход — обработка промпта минутами) idleMs задаёт сама модель.
            const idleMs = Number(options.idleMs) > 0 ? Number(options.idleMs)
                : (Number(ai.idleMs) > 0 ? Number(ai.idleMs) : 180000);
            req.setTimeout?.(idleMs, () => req.destroy(new Error('LLM ' + body.model + ': нет ответа ' + Math.round(idleMs / 1000) + 'с')));
            // Стоп пользователя: abort сразу рвёт соединение (не ждём следующего чанка).
            const signal = options.signal;
            if (signal) {
                if (signal.aborted)
                    req.destroy(new Error('aborted'));
                else
                    signal.addEventListener?.('abort', () => req.destroy(new Error('aborted')), { once: true });
            }
            req.write(JSON.stringify(body));
            req.end();
        });

        if (res?.__localFallback && typeof WORK?.localStreamChat === 'function') {
            yield* WORK.localStreamChat(ai, body, options);
            return;
        }

        if (isAnthropic) {
            yield* anthropicStream(res, body.model);
            return;
        }

        // Вызовы инструментов копятся по index (параллельные tool_calls), отдаются одним событием в конце.
        const calls = [];
        const noteCall = (idx, id, name, args) => {
            const e = calls[idx] ??= { id: '', name: '', args: '' };
            if (id)
                e.id = id;
            if (name)
                e.name = name;
            if (args != null)
                e.args = appendFunctionArgs(e.args, args);
        };
        // Конец ответа: finish_reason и/или [DONE]; без обоих — поток оборвался (цикл агента повторит ход).
        let finishReason = null;
        let sawDone = false;
        const parseLine = function* (line) {
            if (!line.startsWith('data:'))
                return;
            const jsonStr = line.slice(5).trim();
            if (jsonStr === '[DONE]')
                sawDone = true;
            if (!jsonStr || jsonStr === '[DONE]')
                return;
            let json;
            try {
                json = JSON.parse(jsonStr);
            }
            catch {
                return; // не протокол (keep-alive/мусор)
            }
            if (json.error)
                throw new Error('LLM ' + body.model + ': ' + (json.error.message || JSON.stringify(json.error)));
            if (json.choices?.[0]?.finish_reason)
                finishReason = String(json.choices[0].finish_reason);
            const delta = json.choices?.[0]?.delta || json.choices?.[0]?.message || {};
            const reasoning = delta.reasoning ?? delta.reasoning_content;
            if (reasoning)
                yield { type: 'reasoning', content: String(reasoning) };
            const content = delta.content || delta.text;
            if (content)
                yield String(content);
            if (Array.isArray(delta.tool_calls))
                for (const tc of delta.tool_calls)
                    noteCall(tc.index ?? 0, tc.id, tc.function?.name, tc.function?.arguments);
            if (delta.function_call)
                noteCall(0, null, delta.function_call.name, delta.function_call.arguments);
            if (json.usage) {
                const u = json.usage;
                // токены, прочитанные из кэша провайдера: OpenAI (prompt_tokens_details.cached_tokens), DeepSeek (prompt_cache_hit_tokens), Anthropic-поля
                const cached = Number(u.prompt_tokens_details?.cached_tokens ?? u.cached_tokens ?? u.prompt_cache_hit_tokens ?? u.cache_read_input_tokens ?? 0) || 0;
                const cacheWrite = Number(u.cache_creation_input_tokens ?? 0) || 0;
                // prompt_tokens — ПОЛНЫЙ размер запроса, включая кэш (так его читает цикл агента для решения о сжатии);
                // Anthropic-поля input_tokens не включают кэш — тогда полный размер = input + чтение + запись кэша
                let promptTokens = Number(u.prompt_tokens ?? u.promptTokens ?? 0) || 0;
                if (!promptTokens && u.input_tokens != null)
                    promptTokens = (Number(u.input_tokens) || 0) + cached + cacheWrite;
                const completionTokens = Number(u.completion_tokens ?? u.completionTokens ?? u.output_tokens ?? 0) || 0;
                const totalTokens = Number(u.total_tokens ?? u.totalTokens ?? (promptTokens + completionTokens)) || 0;
                yield {
                    type: 'usage',
                    prompt_tokens: promptTokens,
                    completion_tokens: completionTokens,
                    total_tokens: totalTokens,
                    cached_tokens: cached,
                };
            }
        };

        // SSE собирается по целым строкам: хвост чанка (разорванный JSON)
        // держим в буфере до следующего чанка, иначе строка глоталась целиком.
        let buf = '';
        // потоковый декодер: многобайтный символ UTF-8 на границе чанков не превращается в «��»
        const decoder = new TextDecoder('utf-8');
        for await (const chunk of res) {
            buf += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
            // F28: чужой поток без переводов строк не копится в памяти бесконечно
            if (buf.length > SSE_LINE_MAX)
                throw new Error('LLM ' + body.model + ': строка потока превысила ' + Math.round(SSE_LINE_MAX / 1048576) + ' МБ — обрыв');
            const lines = buf.split('\n');
            buf = lines.pop();
            for (const line of lines)
                yield* parseLine(line.trim());
        }
        if (String(buf || '').trim())
            yield* parseLine(buf.trim());

        // reasoning не подменяем content: silent-меню иначе получает абзац «think»
        const done = calls.filter(c => c && c.name);
        if (done.length)
            yield {
                type: 'tool_calls',
                calls: done.map((c, i) => ({
                    id: c.id || ('call_' + Date.now().toString(36) + '_' + i),
                    name: c.name,
                    arguments: parseFunctionArgs(c.args),
                })),
            };
        yield { type: 'finish', reason: finishReason, done: sawDone, dropped: calls.filter(c => c && !c.name).length || undefined };
        })();
    },

    /**
     * Сгенерировать изображение по тексту. Только capabilities `image`. Не chat.
     * @param {object} [params]
     * @param {string} params.prompt Текст сцены
     * @returns {Promise<{ mime: string, base64: string, model: string }>}
     */
    async generateImage(params = {}) {
        const ai = params.$ai || this;
        if (!hasCap(ai, 'image'))
            throw new Error('generateImage: у модели нет capabilities image');
        const prompt = String(params.prompt || params.post || '').trim();
        if (!prompt)
            throw new Error('generateImage: пустой prompt');
        const tag = String(params.model || ai.model || '').trim();
        if (!tag)
            throw new Error('generateImage: нет model');
        const base = String(ai.baseUrl || ai.DATA?.baseUrl || '').trim();
        if (!base)
            throw new Error('generateImage: нет baseUrl у ' + (ai.short || ai.path || '?'));
        let origin;
        try {
            origin = new URL(base).origin;
        }
        catch {
            throw new Error('generateImage: некорректный baseUrl: ' + base);
        }
        const headers = await getAuthHeaders(ai);
        let lastErr = '';
        const jobs = [
            { url: origin + '/api/generate', body: { model: tag, prompt, stream: false } },
            { url: origin + '/v1/images/generations', body: { model: tag, prompt, n: 1, response_format: 'b64_json' } },
        ];
        for (const job of jobs) {
            try {
                const data = await httpsPostJson(job.url, headers, job.body, ai, 180000);
                const pic = pickGeneratedImage(data);
                if (pic)
                    return { ...pic, model: tag };
                lastErr = 'нет изображения в ответе';
            }
            catch (e) {
                lastErr = String(e.message || e);
            }
        }
        throw new Error('generateImage: не удалось получить картинку (' + lastErr + ')');
    },

    /**
     * Синтез речи (capabilities `tts`): OpenAI-совместимый POST {origin}/v1/audio/speech → WAV (Buffer).
     * Поля модели: voice ('default'), ttsTask ('VoiceDesign' | 'CustomVoice' | 'Base'), instructions (описание голоса),
     * language ('Russian'). Через шлюз Bifrost task_type/language проходят только с заголовком passthrough.
     * @param {object} [params]
     * @param {string} params.text Текст (до 1500 символов)
     * @param {string} [params.instructions] Описание голоса/манеры — перекрывает поле модели
     * @param {string} [params.language]
     * @returns {Promise<Buffer>} WAV 24 кГц, 16 бит, моно
     */
    async speak(params = {}) {
        const ai = params.$ai || this;
        if (!hasCap(ai, 'tts'))
            throw new Error('speak: у модели нет capabilities tts');
        const text = String(params.text ?? params.post ?? '').trim().slice(0, 1500);
        if (!text)
            throw new Error('speak: пустой текст');
        const tag = String(params.model || ai.model || '').trim();
        if (!tag)
            throw new Error('speak: нет model');
        const origin = speechOrigin(params, ai, 'speak');
        const headers = await getAuthHeaders(ai);
        headers['x-bf-passthrough-extra-params'] = 'true';
        const body = {
            model: tag,
            input: text,
            voice: String(ai.voice || 'default'),
            response_format: 'wav',
            task_type: String(ai.ttsTask || 'VoiceDesign'),
            language: String(params.language || ai.language || 'Russian'),
        };
        const instructions = String(params.instructions || ai.instructions || '').trim();
        if (instructions)
            body.instructions = instructions;
        const buf = await httpsPostBuffer(origin + '/v1/audio/speech', headers, JSON.stringify(body), 'application/json', ai, 90000);
        if (buf.length < 64 || buf.toString('latin1', 0, 4) !== 'RIFF')
            throw new Error('speak: ответ не WAV: ' + buf.toString('utf-8', 0, 160).replace(/\s+/g, ' '));
        return buf;
    },

    /**
     * Распознавание речи (capabilities `stt`): OpenAI-совместимый POST {origin}/v1/audio/transcriptions (multipart).
     * @param {object} [params]
     * @param {Buffer} params.audio Аудио (WAV 16 кГц моно — самый переносимый вход)
     * @param {string} [params.language] Код языка (ru)
     * @returns {Promise<{ text: string, model: string }>}
     */
    async transcribe(params = {}) {
        const ai = params.$ai || this;
        if (!hasCap(ai, 'stt'))
            throw new Error('transcribe: у модели нет capabilities stt');
        const audio = Buffer.isBuffer(params.audio) ? params.audio : null;
        if (!audio?.length)
            throw new Error('transcribe: нет аудио');
        const tag = String(params.model || ai.model || '').trim();
        if (!tag)
            throw new Error('transcribe: нет model');
        const origin = speechOrigin(params, ai, 'transcribe');
        const headers = await getAuthHeaders(ai);
        delete headers['Content-Type'];
        const form = buildMultipart([
            { name: 'model', value: tag },
            { name: 'language', value: String(params.language || ai.language || 'ru').slice(0, 8) },
            { name: 'response_format', value: 'json' },
            { name: 'temperature', value: '0' },
            { name: 'file', filename: 'speech.wav', type: 'audio/wav', value: audio },
        ]);
        const buf = await httpsPostBuffer(origin + '/v1/audio/transcriptions', headers, form.body, form.type, ai, 90000);
        let data;
        try {
            data = JSON.parse(buf.toString('utf-8'));
        }
        catch {
            throw new Error('transcribe: ответ не JSON: ' + buf.toString('utf-8', 0, 160));
        }
        return { text: String(data?.text ?? '').trim(), model: tag };
    },
};

function speechOrigin(params, ai, who) {
    const base = String(ai.baseUrl || ai.DATA?.baseUrl || '').trim();
    if (!base)
        throw new Error(who + ': нет baseUrl у ' + (ai.short || ai.path || '?'));
    try {
        const u = new URL(base);
        const prefix = u.pathname
            .replace(/\/+$/, '')
            .replace(/\/v1\/(?:chat\/completions|audio\/(?:speech|transcriptions)|images\/generations|models)$/i, '')
            .replace(/\/v1$/i, '');
        return u.origin + prefix;
    }
    catch {
        throw new Error(who + ': некорректный baseUrl: ' + base);
    }
}

/** multipart/form-data: поля и один файл → { body: Buffer, type }. */
export function buildMultipart(parts) {
    const boundary = '----work' + Date.now().toString(16) + Math.random().toString(16).slice(2, 10);
    const chunks = [];
    for (const p of parts) {
        let head = '--' + boundary + '\r\nContent-Disposition: form-data; name="' + p.name + '"';
        if (p.filename)
            head += '; filename="' + p.filename + '"\r\nContent-Type: ' + (p.type || 'application/octet-stream');
        chunks.push(Buffer.from(head + '\r\n\r\n'), Buffer.isBuffer(p.value) ? p.value : Buffer.from(String(p.value)), Buffer.from('\r\n'));
    }
    chunks.push(Buffer.from('--' + boundary + '--\r\n'));
    return { body: Buffer.concat(chunks), type: 'multipart/form-data; boundary=' + boundary };
}

/** POST произвольного тела по HTTP/HTTPS → Buffer ответа (WAV, JSON…). */
function httpsPostBuffer(urlStr, headers, payload, contentType, ai, timeoutMs = 60000) {
    const url = new URL(urlStr);
    const transport = transportFor(url);
    const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload));
    return new Promise((resolve, reject) => {
        const req = transport.request({
            hostname: url.hostname,
            port: url.port || (url.protocol === 'http:' ? 80 : 443),
            path: url.pathname + url.search,
            method: 'POST',
            agent: WORK.tls_agent?.(ai),
            headers: { Accept: '*/*', ...headers, 'Content-Type': contentType, 'Content-Length': data.length },
            timeout: timeoutMs,
        }, (res) => {
            const chunks = [];
            let size = 0;
            let overflow = false;
            // R7 (8.35): бинарный ответ (WAV) — потолок: чужой мусор не копится в памяти
            res.on('data', c => {
                if (overflow)
                    return;
                size += c.length;
                if (size > REMOTE_BODY_MAX) {
                    overflow = true;
                    chunks.length = 0;
                    req.destroy();
                    reject(new Error('ответ превысил ' + Math.round(REMOTE_BODY_MAX / 1048576) + ' МБ — обрыв'));
                    return;
                }
                chunks.push(c);
            });
            res.on('end', () => {
                if (overflow)
                    return;
                const buf = Buffer.concat(chunks);
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    reject(new Error('HTTP ' + res.statusCode + ': ' + buf.toString('utf-8', 0, 200)));
                    return;
                }
                resolve(buf);
            });
        });
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('timeout'));
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

function hasCap(ai, name) {
    const c = ai?.capabilities;
    if (Array.isArray(c))
        return c.includes(name);
    return String(c || '').split(/[\s,]+/).filter(Boolean).includes(name);
}

function applyEffort(body, ai, options = {}) {
    if (!hasCap(ai, 'effort') || !('effort' in options))
        return;
    const effort = options.effort;
    if (effort == null || effort === '')
        return;
    const off = effort === 'off' || effort === false;
    const native = ai.protocol === 'ollama' || /\/api\/chat\b/.test(String(ai.baseUrl || ''));
    if (native)
        body.think = off ? false : (effort === true ? true : effort);
    else
        body.reasoning_effort = off ? 'none' : (effort === true ? 'medium' : effort);
}

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
 * OpenAI/z.ai: harness `function_call: { name }` → `tool_choice` (не оставлять auto).
 * @param {{ tool_choice?: unknown, function_call?: 'auto'|'none'|{ name?: string } }} options
 * @returns {'auto'|'none'|{ type: 'function', function: { name: string } }}
 */
export function resolveOpenAiToolChoice(options = {}) {
    if (options.tool_choice != null)
        return options.tool_choice;
    const fc = options.function_call;
    if (fc === 'none')
        return 'none';
    if (fc && typeof fc === 'object' && fc.name)
        return { type: 'function', function: { name: String(fc.name) } };
    return 'auto';
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
 * GigaChat FC: только name/description/parameters (без _servicePath и прочего).
 * Битые property без type → string; пустой name пропускаем.
 * @param {Array} functions
 * @returns {Array<{name:string,description:string,parameters:object}>}
 */
export function sanitizeGigaChatFunctions(functions) {
    if (!Array.isArray(functions))
        return [];
    const out = [];
    for (const fn of functions) {
        if (!fn || typeof fn !== 'object' || !fn.name)
            continue;
        const name = String(fn.name).trim();
        if (!name || !/^[\w.-]+$/.test(name))
            continue;
        let parameters = fn.parameters;
        if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters))
            parameters = { type: 'object', properties: {} };
        else {
            const propsIn = parameters.properties && typeof parameters.properties === 'object'
                ? parameters.properties
                : {};
            const propsOut = {};
            for (const [key, prop] of Object.entries(propsIn)) {
                if (!key || typeof prop !== 'object' || prop == null)
                    continue;
                const type = ['string', 'number', 'integer', 'boolean', 'object', 'array'].includes(prop.type)
                    ? prop.type
                    : 'string';
                const clean = { type, description: String(prop.description || '') };
                if (type === 'object')
                    clean.properties = (prop.properties && typeof prop.properties === 'object')
                        ? prop.properties
                        : {};
                if (type === 'array')
                    clean.items = prop.items && typeof prop.items === 'object'
                        ? prop.items
                        : { type: 'string' };
                propsOut[key] = clean;
            }
            const required = Array.isArray(parameters.required)
                ? parameters.required.filter(k => k in propsOut)
                : [];
            parameters = { type: 'object', properties: propsOut };
            if (required.length)
                parameters.required = required;
        }
        out.push({
            name,
            description: String(fn.description || name).slice(0, 500),
            parameters,
        });
    }
    return out;
}

/**
 * Убрать из messages FC-пары, чьих имён нет в functions (иначе GigaChat 422).
 * Оставить только валидные пары assistant.function_call + role:function.
 * @param {Array} messages
 * @param {Array<{name?: string}>} functions
 * @returns {Array}
 */
export function sanitizeGigaChatMessages(messages, functions = []) {
    if (!Array.isArray(messages))
        return [];
    const allowed = new Set(
        (functions || []).map(f => f?.name).filter(Boolean),
    );
    const out = [];
    for (let i = 0; i < messages.length; i++) {
        const m = messages[i];
        if (!m || typeof m !== 'object')
            continue;
        if (m.role === 'assistant' && m.function_call?.name) {
            const fname = String(m.function_call.name);
            const next = messages[i + 1];
            const paired = next?.role === 'function' && String(next.name || '') === fname;
            if (!allowed.has(fname) || !paired) {
                const args = m.function_call.arguments;
                const argsStr = typeof args === 'string' ? args : JSON.stringify(args || {});
                out.push({
                    role: 'assistant',
                    content: (m.content ? String(m.content) + '\n' : '')
                        + '[function_call ' + fname + ' ' + argsStr + ']',
                });
                if (paired) {
                    out.push({
                        role: 'user',
                        content: 'Результат ' + fname + ':\n' + String(next.content ?? ''),
                    });
                    i++;
                }
                continue;
            }
            const args = m.function_call.arguments;
            out.push({
                role: 'assistant',
                content: m.content == null ? '' : String(m.content),
                function_call: {
                    name: fname,
                    arguments: (args && typeof args === 'object' && !Array.isArray(args))
                        ? args
                        : (typeof args === 'string'
                            ? (() => { try { return JSON.parse(args); } catch { return {}; } })()
                            : {}),
                },
            });
            continue;
        }
        if (m.role === 'function') {
            const fname = String(m.name || '');
            if (!allowed.has(fname)) {
                out.push({
                    role: 'user',
                    content: 'Результат ' + (fname || 'метода') + ':\n' + String(m.content ?? ''),
                });
                continue;
            }
            out.push({
                role: 'function',
                name: fname,
                content: m.content == null ? '' : String(m.content),
            });
            continue;
        }
        out.push(m);
    }
    return out;
}

/**
 * OpenAI tool_calls/role:tool → GigaChat function_call/role:function (по одному вызову на ход:
 * лишние параллельные вызовы превращаются в текст — GigaChat их не принимает).
 * @param {Array} messages
 * @returns {Array}
 */
export function toGigaChatMessages(messages) {
    if (!Array.isArray(messages))
        return [];
    const names = new Map();
    const out = [];
    for (const m of messages) {
        if (!m || typeof m !== 'object')
            continue;
        if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length) {
            const [first, ...rest] = m.tool_calls;
            for (const tc of m.tool_calls)
                names.set(tc.id, tc.function?.name);
            const extra = rest.map(tc => '[' + tc.function?.name + ' ' + tc.function?.arguments + ']').join('\n');
            let args = first.function?.arguments;
            try { args = typeof args === 'string' ? JSON.parse(args || '{}') : (args || {}); } catch { args = {}; }
            out.push({
                role: 'assistant',
                content: [m.content, extra].filter(Boolean).join('\n'),
                function_call: { name: first.function?.name, arguments: args },
            });
            continue;
        }
        if (m.role === 'tool') {
            out.push({ role: 'function', name: names.get(m.tool_call_id) || 'tool', content: String(m.content ?? '') });
            continue;
        }
        out.push(m);
    }
    return out;
}

/**
 * Нормализация messages для OpenAI/GLM: нет role:function, есть непустой user.
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

// ── Anthropic Messages API (protocol: 'anthropic') ─────────────────────────────
// Нативный формат: system-блоки, tool_use/tool_result, input_json_delta, thinking с подписью, cache_control.
// Чистые функции (без импортов — класс загружается как data: URL): покрыты tests/anthropic.test.js.

export const ANTHROPIC_VERSION = '2023-06-01';
/** Начало служебного сообщения с изменчивой частью среды (agent/loop.js VOLATILE_HEAD; тест держит их в синхроне). */
export const ANTHROPIC_VOLATILE_PREFIX = '[Служебный контекст среды';
const ANTHROPIC_EFFORT_BUDGET = { low: 2048, medium: 8192, high: 16384, xhigh: 32768, max: 49152 };
const EPHEMERAL = { type: 'ephemeral' };

/** baseUrl → адрес Messages API: хост, …/v1 или …/v1/messages (устаревший …/chat/completions заменяется). */
export function anthropicUrl(baseUrl) {
    const u = new URL(String(baseUrl || ''));
    let p = u.pathname.replace(/\/+$/, '');
    if (/\/chat\/completions$/.test(p))
        p = p.replace(/\/chat\/completions$/, '/messages');
    else if (!/\/messages$/.test(p))
        p += /\/v1$/.test(p) ? '/messages' : '/v1/messages';
    u.pathname = p;
    return u.toString();
}

/** OpenAI tools[] → Anthropic tools[]; cache_control на последнем (кэш всего блока инструментов). */
export function toAnthropicTools(tools, { cache = true } = {}) {
    if (!Array.isArray(tools) || !tools.length)
        return undefined;
    const out = tools.map(t => {
        const f = t.function || t;
        const schema = f.parameters && typeof f.parameters === 'object' ? f.parameters : { type: 'object', properties: {} };
        return { name: String(f.name), description: String(f.description || f.name), input_schema: schema };
    });
    if (cache)
        out[out.length - 1].cache_control = EPHEMERAL;
    return out;
}

function anthropicContentBlocks(content) {
    const parts = Array.isArray(content) ? content : [content];
    const out = [];
    for (const p of parts) {
        if (p == null)
            continue;
        if (typeof p === 'string') {
            if (p.trim())
                out.push({ type: 'text', text: p });
            continue;
        }
        if (p.type === 'text' || typeof p.text === 'string') {
            if (String(p.text || '').trim())
                out.push({ type: 'text', text: String(p.text) });
        }
        else if (p.type === 'image_url' || p.image_url) {
            const url = String(p.image_url?.url ?? p.image_url ?? '');
            const m = url.match(/^data:([^;,]+);base64,(.*)$/s);
            if (m)
                out.push({ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } });
            else if (/^https?:\/\//i.test(url))
                out.push({ type: 'image', source: { type: 'url', url } });
        }
    }
    return out;
}

function parseToolInput(args) {
    if (args && typeof args === 'object' && !Array.isArray(args))
        return args;
    try {
        const v = JSON.parse(String(args || '{}'));
        return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    }
    catch {
        return {};
    }
}

/**
 * OpenAI-сообщения (как их собирает цикл агента) → { system: [блоки], messages }.
 *  - все system → блоки system; cache_control на последнем;
 *  - tool-результаты подряд → ОДНО user-сообщение (tool_result первыми), за ним — остальные блоки того же хода;
 *  - соседние сообщения одной роли склеиваются; первое сообщение — user;
 *  - блоки размышлений (неперечисляемое msg.thinking_blocks) — только при включённом thinking;
 *  - точка кэша истории — последний блок ДО изменчивого служебного сообщения (оно меняется каждый ход:
 *    кэш на нём писался бы впустую). Всего точек кэша не больше трёх (инструменты, system, история).
 */
export function toAnthropicMessages(messages, { thinking = false, cache = true } = {}) {
    const system = [];
    const out = [];
    const tail = new Set();
    const push = (role, blocks, isTail) => {
        if (!blocks.length)
            return;
        if (isTail)
            for (const b of blocks)
                tail.add(b);
        const last = out[out.length - 1];
        if (last && last.role === role)
            last.content.push(...blocks);
        else
            out.push({ role, content: [...blocks] });
    };
    for (const m of Array.isArray(messages) ? messages : []) {
        if (!m || typeof m !== 'object')
            continue;
        if (m.role === 'system') {
            system.push(...anthropicContentBlocks(m.content));
        }
        else if (m.role === 'user') {
            const isTail = typeof m.content === 'string' && m.content.startsWith(ANTHROPIC_VOLATILE_PREFIX);
            push('user', anthropicContentBlocks(m.content), isTail);
        }
        else if (m.role === 'assistant') {
            const blocks = [];
            if (thinking && Array.isArray(m.thinking_blocks))
                blocks.push(...m.thinking_blocks);
            blocks.push(...anthropicContentBlocks(m.content));
            for (const tc of Array.isArray(m.tool_calls) ? m.tool_calls : [])
                blocks.push({ type: 'tool_use', id: String(tc.id), name: String(tc.function?.name || tc.name), input: parseToolInput(tc.function?.arguments ?? tc.arguments) });
            push('assistant', blocks, false);
        }
        else if (m.role === 'tool') {
            const text = String(m.content ?? '');
            const block = { type: 'tool_result', tool_use_id: String(m.tool_call_id) };
            if (text)
                block.content = text;
            if (/^(<untrusted[^>]*>\s*)?Ошибка:/.test(text))
                block.is_error = true;
            push('user', [block], false);
        }
    }
    // tool_result должны идти первыми в user-сообщении (за ними — текст/картинки того же хода)
    for (const m of out)
        if (m.role === 'user')
            m.content = [...m.content.filter(b => b.type === 'tool_result'), ...m.content.filter(b => b.type !== 'tool_result')];
    if (!out.length || out[0].role !== 'user')
        out.unshift({ role: 'user', content: [{ type: 'text', text: 'Продолжай.' }] });
    const systemOut = system.length ? system : undefined;
    if (cache) {
        if (systemOut)
            systemOut[systemOut.length - 1].cache_control = EPHEMERAL;
        // последний блок истории, который не относится к изменчивому хвосту
        done: for (let i = out.length - 1; i >= 0; i--)
            for (let j = out[i].content.length - 1; j >= 0; j--) {
                const b = out[i].content[j];
                if (tail.has(b) || b.type === 'thinking' || b.type === 'redacted_thinking')
                    continue;
                b.cache_control = EPHEMERAL;
                break done;
            }
    }
    return { system: systemOut, messages: out };
}

/** Тело запроса Messages API из параметров streamChat (OpenAI-стиль: messages, tools, maxOutput, effort, stop…). */
export function buildAnthropicRequest(ai, options = {}, tools = null) {
    const cache = ai.promptCache !== false;
    const cap = Number(options.maxOutput);
    const maxTokens = Number.isFinite(cap) && cap > 0 ? cap : (Number(ai.maxOutput) > 0 ? Number(ai.maxOutput) : 8192);
    // effort → thinking.budget_tokens (минимум 1024, строго меньше max_tokens)
    let thinking = null;
    const effort = options.effort;
    if (hasCap(ai, 'effort') && effort != null && effort !== '' && effort !== 'off' && effort !== false) {
        const want = ANTHROPIC_EFFORT_BUDGET[effort] ?? (effort === true ? ANTHROPIC_EFFORT_BUDGET.medium : (Number(effort) >= 1024 ? Number(effort) : 0));
        const budget = Math.min(want, maxTokens - 1024);
        if (budget >= 1024)
            thinking = { type: 'enabled', budget_tokens: budget };
    }
    const conv = toAnthropicMessages(options.messages || [], { thinking: !!thinking, cache });
    const body = { model: options.model || ai.model || '', max_tokens: maxTokens, stream: true, messages: conv.messages };
    if (conv.system)
        body.system = conv.system;
    if (thinking)
        body.thinking = thinking;
    else
        body.temperature = options.temperature ?? 0.7;
    if (options.stop)
        body.stop_sequences = Array.isArray(options.stop) ? options.stop : [options.stop];
    const anthropicTools = toAnthropicTools(tools, { cache });
    if (anthropicTools) {
        body.tools = anthropicTools;
        const choice = resolveOpenAiToolChoice(options);
        let tc;
        if (choice === 'none')
            tc = { type: 'none' };
        else if (choice === 'required')
            tc = { type: 'any' };
        else if (choice && typeof choice === 'object' && choice.function?.name)
            tc = { type: 'tool', name: String(choice.function.name) };
        else
            tc = { type: 'auto' };
        // с thinking разрешены только auto/none
        if (thinking && (tc.type === 'any' || tc.type === 'tool'))
            tc = { type: 'auto' };
        if (options.parallel_tool_calls === false && tc.type !== 'none')
            tc.disable_parallel_tool_use = true;
        body.tool_choice = tc;
    }
    return body;
}

const ANTHROPIC_STOP = { end_turn: 'stop', stop_sequence: 'stop', tool_use: 'tool_calls', max_tokens: 'length', model_context_window_exceeded: 'length', refusal: 'content_filter' };

/**
 * Разбор SSE-событий Messages API в события адаптера (строки текста, reasoning, thinking_blocks, tool_calls, usage, finish).
 * feed(event) вызывается на каждое событие и возвращает готовые куски; end() — итоговые (по концу потока).
 */
export function createAnthropicParser(model = '') {
    const blocks = [];
    const usage = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
    let stop = null;
    let done = false;
    const takeUsage = u => {
        if (!u)
            return;
        if (u.input_tokens != null) usage.input = Number(u.input_tokens) || 0;
        if (u.cache_read_input_tokens != null) usage.cacheRead = Number(u.cache_read_input_tokens) || 0;
        if (u.cache_creation_input_tokens != null) usage.cacheWrite = Number(u.cache_creation_input_tokens) || 0;
        if (u.output_tokens != null) usage.output = Number(u.output_tokens) || 0;
    };
    return {
        feed(ev) {
            const out = [];
            switch (ev?.type) {
                case 'message_start':
                    takeUsage(ev.message?.usage);
                    break;
                case 'content_block_start': {
                    const cb = ev.content_block || {};
                    blocks[ev.index] = { type: cb.type, id: cb.id, name: cb.name, args: '', thinking: cb.thinking || '', signature: cb.signature || '', data: cb.data };
                    if (cb.type === 'text' && cb.text)
                        out.push(String(cb.text));
                    break;
                }
                case 'content_block_delta': {
                    const d = ev.delta || {};
                    const b = blocks[ev.index] ??= { type: d.type === 'input_json_delta' ? 'tool_use' : 'text', args: '', thinking: '', signature: '' };
                    if (d.type === 'text_delta' && d.text)
                        out.push(String(d.text));
                    else if (d.type === 'input_json_delta')
                        b.args += d.partial_json || '';
                    else if (d.type === 'thinking_delta' && d.thinking) {
                        b.thinking += d.thinking;
                        out.push({ type: 'reasoning', content: String(d.thinking) });
                    }
                    else if (d.type === 'signature_delta')
                        b.signature += d.signature || '';
                    break;
                }
                case 'message_delta':
                    stop = ev.delta?.stop_reason ?? stop;
                    takeUsage(ev.usage);
                    break;
                case 'message_stop':
                    done = true;
                    break;
                case 'error':
                    throw new Error('LLM ' + model + ': ' + (ev.error?.message || JSON.stringify(ev.error || ev)));
            }
            return out;
        },
        end() {
            const out = [];
            const present = blocks.map((b, index) => ({ b, index })).filter(x => x.b);
            const thinking = present.map(x => x.b).filter(b => (b.type === 'thinking' && b.signature) || b.type === 'redacted_thinking')
                .map(b => b.type === 'thinking' ? { type: 'thinking', thinking: b.thinking, signature: b.signature } : { type: 'redacted_thinking', data: b.data });
            if (thinking.length)
                out.push({ type: 'thinking_blocks', blocks: thinking });
            const calls = present.filter(x => x.b.type === 'tool_use' && x.b.name)
                .map(x => ({ id: x.b.id, name: x.b.name, arguments: parseFunctionArgs(x.b.args) }));
            if (calls.length)
                out.push({ type: 'tool_calls', calls });
            const prompt = usage.input + usage.cacheRead + usage.cacheWrite;
            out.push({
                type: 'usage', prompt_tokens: prompt, completion_tokens: usage.output, total_tokens: prompt + usage.output,
                cached_tokens: usage.cacheRead, cache_creation_tokens: usage.cacheWrite,
            });
            out.push({ type: 'finish', reason: stop ? (ANTHROPIC_STOP[stop] || stop) : null, done });
            return out;
        },
    };
}

/** SSE-поток Messages API (res — ответ HTTP) → события адаптера. Строки `event:` не нужны: тип есть в каждом data. */
async function* anthropicStream(res, model) {
    const parser = createAnthropicParser(model);
    const decoder = new TextDecoder('utf-8');
    let buf = '';
    const line = function* (raw) {
        const l = raw.trim();
        if (!l.startsWith('data:'))
            return;
        const s = l.slice(5).trim();
        if (!s || s === '[DONE]')
            return;
        let json;
        try {
            json = JSON.parse(s);
        }
        catch {
            return; // keep-alive/мусор
        }
        yield* parser.feed(json);
    };
    for await (const chunk of res) {
        buf += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
        // F28: чужой поток без переводов строк не копится в памяти бесконечно
        if (buf.length > SSE_LINE_MAX)
            throw new Error('LLM ' + model + ': строка потока превысила ' + Math.round(SSE_LINE_MAX / 1048576) + ' МБ — обрыв');
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const l of lines)
            yield* line(l);
    }
    if (buf.trim())
        yield* line(buf);
    yield* parser.end();
}

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
            headers['x-api-key'] = await resolveKey(ai, ai.apiKey);
            headers['anthropic-version'] = ANTHROPIC_VERSION;
            if (ai.anthropicBeta)
                headers['anthropic-beta'] = String(ai.anthropicBeta);
            break;
        }
        case 'openai':
        default: {
            const key = await resolveKey(ai, ai.apiKey);
            if (key)
                headers['Authorization'] = 'Bearer ' + key;
        }
    }
    return headers;
}

/**
 * Значение ключа: литерал | `env:ИМЯ` (process.env) | `secret:ФАЙЛ` (#secret модели,
 * затем вверх по родителям — провайдер, MODELS). В файле секрета — value|apiKey|token|key.
 * @param {object} ai модель
 * @param {string} raw значение поля
 * @returns {Promise<string>}
 */
export async function resolveKey(ai, raw) {
    const s = String(raw ?? '').trim();
    if (!s)
        return '';
    if (/^env:/i.test(s))
        return String(process.env[s.slice(4).trim()] || '');
    if (!/^secret:/i.test(s))
        return s;
    const filename = s.slice(7).trim();
    let cur = ai;
    for (let i = 0; i < 6 && cur; i++) {
        if (typeof cur.read_secret === 'function') {
            try {
                const data = await cur.read_secret({ filename });
                const v = typeof data === 'string' ? data
                    : data?.value ?? data?.apiKey ?? data?.token ?? data?.key;
                if (v)
                    return String(v);
            }
            catch { /* выше по дереву */ }
        }
        cur = cur.$parent ?? cur.parent;
    }
    throw new Error('ключ модели: нет секрета ' + filename + ' (#secret/' + filename + ' у модели или провайдера)');
}

/** POST JSON по HTTP/HTTPS (generateImage). timeoutMs — долгая генерация картинки. */
function httpsPostJson(urlStr, headers, body, ai, timeoutMs = 60000) {
    const url = new URL(urlStr);
    const transport = transportFor(url);
    const payload = JSON.stringify(body || {});
    return new Promise((resolve, reject) => {
        const req = transport.request({
            hostname: url.hostname,
            port: url.port || (url.protocol === 'http:' ? 80 : 443),
            path: url.pathname + url.search,
            method: 'POST',
            agent: WORK.tls_agent?.(ai),
            headers: { Accept: 'application/json', ...headers, 'Content-Length': Buffer.byteLength(payload) },
            timeout: timeoutMs,
        }, (res) => {
            // F28: тело ответа — с потолком (картинки b64 — мегабайты, влезают; чужие гигабайты — нет)
            const chunks = [];
            let size = 0;
            res.on('data', c => {
                size += c.length;
                if (size > JSON_BODY_MAX) {
                    res.destroy();
                    return;
                }
                chunks.push(c);
            });
            res.on('error', () => reject(new Error('HTTP ' + res.statusCode + ': тело ответа больше '
                + Math.round(JSON_BODY_MAX / 1048576) + ' МБ (или соединение оборвано)')));
            // destroy() без ошибки не всегда даёт 'error'/'end' — 'close' приходит всегда
            res.on('close', () => {
                if (size > JSON_BODY_MAX)
                    reject(new Error('HTTP ' + res.statusCode + ': тело ответа больше '
                        + Math.round(JSON_BODY_MAX / 1048576) + ' МБ'));
            });
            res.on('end', () => {
                // F28: даже если 'end' пришёл после destroy — переполненное тело не парсим
                if (size > JSON_BODY_MAX) {
                    reject(new Error('HTTP ' + res.statusCode + ': тело ответа больше '
                        + Math.round(JSON_BODY_MAX / 1048576) + ' МБ'));
                    return;
                }
                const text = Buffer.concat(chunks).toString('utf-8');
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    reject(new Error('HTTP ' + res.statusCode + ': ' + text.slice(0, 160)));
                    return;
                }
                try {
                    resolve(JSON.parse(text));
                }
                catch (e) {
                    reject(new Error('JSON: ' + e.message));
                }
            });
        });
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('timeout'));
        });
        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}

/**
 * HTTP/HTTPS-транспорт: локальные endpoint'ы (Ollama http://127.0.0.1:11434) —
 * через WORK.http, облачные API — через WORK.https.
 * До этого здесь был только WORK.https: любой http-baseUrl (локальный сервер
 * модели) падал с `SSL wrong version number`.
 * @param {URL} url
 * @returns {object} node:http или node:https
 */
function transportFor(url) {
    if (String(url.protocol || '').toLowerCase() === 'http:') {
        if (WORK.http)
            return WORK.http;
        throw new Error('локальный http-endpoint недоступен: нет WORK.http (' + url.href + ')');
    }
    return WORK.https;
}

/** Ответ Ollama /api/generate или OpenAI /v1/images/generations → { mime, base64 }. */
function pickGeneratedImage(data) {
    if (!data || typeof data !== 'object')
        return null;
    const raws = [];
    if (typeof data.image === 'string')
        raws.push(data.image);
    if (Array.isArray(data.images))
        raws.push(...data.images.filter(x => typeof x === 'string'));
    if (typeof data.b64_json === 'string')
        raws.push(data.b64_json);
    if (Array.isArray(data.data)) {
        for (const row of data.data) {
            if (row?.b64_json)
                raws.push(row.b64_json);
            else if (row?.b64)
                raws.push(row.b64);
        }
    }
    const raw = raws.find(s => s && String(s).length > 80);
    if (!raw)
        return null;
    let b64 = String(raw).replace(/\s/g, '');
    let mime = 'image/png';
    const dataUrl = b64.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
    if (dataUrl) {
        mime = dataUrl[1];
        b64 = dataUrl[2];
    }
    else if (b64.startsWith('/9j/'))
        mime = 'image/jpeg';
    else if (b64.startsWith('iVBORw0KGgo'))
        mime = 'image/png';
    return { mime, base64: b64 };
}

/** GET JSON по HTTP/HTTPS (list_remote и т.п.). */
function httpsGetJson(urlStr, headers, ai) {
    const url = new URL(urlStr);
    const transport = transportFor(url);
    return new Promise((resolve, reject) => {
        const req = transport.request({
            hostname: url.hostname,
            port: url.port || (url.protocol === 'http:' ? 80 : 443),
            path: url.pathname + url.search,
            method: 'GET',
            agent: WORK.tls_agent?.(ai),
            headers: { Accept: 'application/json', ...headers },
            timeout: 15000,
        }, (res) => {
            const chunks = [];
            let size = 0;
            let overflow = false;
            // R7 (8.35): JSON-ответ — потолок (как generateImage): чужой мусор не копится в памяти
            res.on('data', c => {
                if (overflow)
                    return;
                size += c.length;
                if (size > JSON_BODY_MAX) {
                    overflow = true;
                    chunks.length = 0;
                    req.destroy();
                    reject(new Error('JSON-ответ превысил ' + Math.round(JSON_BODY_MAX / 1048576) + ' МБ — обрыв'));
                    return;
                }
                chunks.push(c);
            });
            res.on('end', () => {
                if (overflow)
                    return;
                const body = Buffer.concat(chunks).toString('utf-8');
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    reject(new Error('HTTP ' + res.statusCode + ': ' + body.slice(0, 120)));
                    return;
                }
                try {
                    resolve(JSON.parse(body));
                }
                catch (e) {
                    reject(new Error('JSON: ' + e.message));
                }
            });
        });
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('timeout'));
        });
        req.on('error', reject);
        req.end();
    });
}

/** Ollama /api/tags → models[].name; OpenAI /v1/models → data[].id */
function normalizeRemoteModelIds(data) {
    if (!data || typeof data !== 'object')
        return [];
    if (Array.isArray(data.models))
        return data.models.map(m => String(m?.name || m?.model || '').trim()).filter(Boolean);
    if (Array.isArray(data.data))
        return data.data.map(m => String(m?.id || m?.name || '').trim()).filter(Boolean);
    if (Array.isArray(data))
        return data.map(m => String(typeof m === 'string' ? m : (m?.id || m?.name || '')).trim()).filter(Boolean);
    return [];
}

/** Authorization key GigaChat: поле token модели (литерал | env: | secret:), запасной — env GIGACHAT_KEY. */
export async function gigachatToken(ai) {
    try {
        const token = await resolveKey(ai, ai.token);
        if (token)
            return token;
    }
    catch (e) {
        if (!process.env.GIGACHAT_KEY)
            throw e;
    }
    const fallback = String(process.env.GIGACHAT_KEY || '').trim();
    if (!fallback)
        throw new Error('GigaChat: не задан ключ — положите {"token": "..."} в /MODELS/GigaChat/$provider/#secret/gigachat.json или задайте env GIGACHAT_KEY');
    return fallback;
}

async function gigachatAuth(ai) {
    const url = new URL(ai.authUrl);
    const token = await gigachatToken(ai);
    return new Promise((resolve, reject) => {
        const req = WORK.https.request({
            hostname: url.hostname,
            port: url.port || 9443,
            path: url.pathname,
            method: 'POST',
            agent: WORK.tls_agent?.(ai),
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json',
                'RqUID': crypto.randomUUID(),
                'Authorization': 'Bearer ' + token,
            },
        }, (res) => {
            const chunks = [];
            let size = 0;
            let overflow = false;
            // R7 (8.35): ответ auth — JSON-потолок: чужой мусор не копится в памяти
            res.on('data', c => {
                if (overflow)
                    return;
                size += c.length;
                if (size > JSON_BODY_MAX) {
                    overflow = true;
                    chunks.length = 0;
                    req.destroy();
                    reject(new Error('GigaChat auth: ответ превысил ' + Math.round(JSON_BODY_MAX / 1048576) + ' МБ — обрыв'));
                    return;
                }
                chunks.push(c);
            });
            res.on('end', () => {
                if (overflow)
                    return;
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

