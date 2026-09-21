/**
 * $service — корневой тип внешних сервисов-коннекторов.
 *
 * METADATA содержит поля для настройки подключения.
 * Методы сервиса (methods/) доступны ИИ как функции (function calling).
 *
 * MCP-провайдеры двух видов (один класс сущности, разница в полях):
 * - локальные (stdio): `mcp: { command, args, env }` — процесс рядом;
 * - прокси (remote): `mcp: { url, headers }` — чужой HTTP-эндпоинт.
 * Оба получают клиент бесплатно: `mcp_list_tools` / `mcp_call_tool`.
 * Токены — только `secret:ФАЙЛ` (резолв через read_secret),
 * открытым текстом в class.js запрещены.
 */
export default {
    icon: 'carbon:api',
    description: 'Внешние сервисы и коннекторы',

    METADATA: {
        FIELDS: [{
            id: 'baseUrl',
            type: 'String',
            placeholder: 'https://example.com',
        }, {
            id: 'apiKey',
            type: 'String',
            placeholder: 'API ключ (если требуется)',
        }, {
            id: 'capabilities',
            type: 'String',
            placeholder: 'search, translate, ...',
        }],
    },

    /**
     * Список инструментов MCP-сервера (JSON-RPC tools/list).
     * @returns {Promise<object>} {tools: [{name, description, inputSchema}]}
     */
    async mcp_list_tools() {
        return mcpRpc(this, 'tools/list', {});
    },

    /**
     * Вызов инструмента MCP-сервера (JSON-RPC tools/call).
     * @param {object} [params]
     * @param {string} params.name Имя инструмента
     * @param {object} [params.arguments] Аргументы инструмента
     * @returns {Promise<object>} {content: [{type, text}], isError?}
     */
    async mcp_call_tool(params = {}) {
        const name = String(params.name || '').trim();
        if (!name)
            return { error: 'mcp_call_tool: нужно name инструмента' };
        const result = await mcpRpc(this, 'tools/call', {
            name,
            arguments: params.arguments && typeof params.arguments === 'object' ? params.arguments : {},
        });
        if (result?.error)
            return result;
        return result?.result ?? result;
    },
};

const MCP_START_TIMEOUT = 15000;
const MCP_CALL_TIMEOUT = 60000;

/** Один JSON-RPC обмен с MCP-сервером: stdio (spawn) или remote (HTTP). */
async function mcpRpc(owner, method, params) {
    const cfg = owner?.mcp || {};
    if (String(cfg.url || '').trim())
        return mcpHttpRpc(owner, method, params);
    let command = String(cfg.command || '').trim();
    const args = Array.isArray(cfg.args) ? cfg.args.map(String) : [];
    if (!command)
        return { error: 'mcp: нет mcp.command (stdio) или mcp.url (remote) в class.js провайдера' };
    const env = await mcpEnv(owner, cfg.env);
    if (env.error)
        return env;
    if (process.platform === 'win32' && /^npx$/i.test(command))
        command = 'npx.cmd';
    let child;
    try {
        const { spawn } = await import('node:child_process');
        child = spawn(command, args, { env: { ...process.env, ...env.vars }, stdio: ['pipe', 'pipe', 'pipe'] });
    }
    catch (e) {
        return { error: 'mcp: не стартует ' + command + ': ' + String(e.message || e) };
    }
    try {
        const rpc = mcpChannel(child);
        await rpc.request('initialize', {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'work-mcp', version: '1.0.0' },
        }, MCP_START_TIMEOUT);
        rpc.notify('notifications/initialized');
        return await rpc.request(method, params || {}, MCP_CALL_TIMEOUT);
    }
    catch (e) {
        return { error: 'mcp ' + method + ': ' + String(e.message || e) };
    }
    finally {
        try {
            child.kill();
        }
        catch { /* уже мёртв */ }
    }
}

/** Remote MCP поверх Streamable HTTP: initialize (сессия) → method.
 *  Заголовки — только явные `mcp.headers` (значения `secret:ФАЙЛ` резолвятся). */
async function mcpHttpRpc(owner, method, params) {
    const cfg = owner?.mcp || {};
    const url = String(cfg.url || '').trim();
    if (!/^https?:\/\//i.test(url))
        return { error: 'mcp: плохой mcp.url: ' + url };
    const env = await mcpEnv(owner, cfg.headers);
    if (env.error)
        return env;
    const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        ...env.vars,
    };
    let seq = 1;
    const call = async (m, p, sessionId) => {
        const res = await fetch(url, {
            method: 'POST',
            headers: sessionId ? { ...headers, 'Mcp-Session-Id': sessionId } : headers,
            body: JSON.stringify({ jsonrpc: '2.0', id: seq++, method: m, params: p || {} }),
            signal: AbortSignal.timeout(MCP_CALL_TIMEOUT),
        });
        if (res.status === 401 || res.status === 403)
            throw new Error('HTTP ' + res.status + ' — нужен ключ (secret:ФАЙЛ в headers)');
        if (!res.ok)
            throw new Error('HTTP ' + res.status);
        const sid = res.headers.get('mcp-session-id') || sessionId;
        const msg = parseHttpRpc(await res.text());
        if (!msg)
            throw new Error('пустой ответ');
        if (msg.error)
            throw new Error(msg.error.message || JSON.stringify(msg.error));
        return { result: msg.result, sessionId: sid };
    };
    try {
        const init = await call('initialize', {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'work-mcp', version: '1.0.0' },
        });
        const out = await call(method, params || {}, init.sessionId);
        return out.result ?? out;
    }
    catch (e) {
        return { error: 'mcp ' + method + ' (' + url + '): ' + String(e.message || e) };
    }
}

/** Ответ Streamable HTTP: JSON или SSE-поток (строки `data:`). */
function parseHttpRpc(body) {
    const text = String(body || '').trim();
    if (!text)
        return null;
    try {
        const msg = JSON.parse(text);
        if (msg && typeof msg === 'object' && ('result' in msg || 'error' in msg))
            return msg;
    }
    catch { /* ниже — SSE */ }
    for (const line of text.split('\n')) {
        const t = line.trim();
        if (!t.startsWith('data:'))
            continue;
        const payload = t.slice(5).trim();
        if (!payload || payload === '[DONE]')
            continue;
        try {
            const msg = JSON.parse(payload);
            if (msg && typeof msg === 'object' && ('result' in msg || 'error' in msg))
                return msg;
        }
        catch { /* следующая строка */ }
    }
    return null;
}

/** Переменные окружения / заголовки: `secret:ФАЙЛ` резолвятся через read_secret владельца. */
async function mcpEnv(owner, env) {
    const vars = {};
    for (const [k, v] of Object.entries(env && typeof env === 'object' ? env : {})) {
        const s = String(v ?? '');
        if (/^secret:/i.test(s)) {
            const filename = s.slice(7).trim();
            try {
                const data = await owner.read_secret({ filename });
                const value = typeof data === 'string' ? data
                    : data?.value ?? data?.token ?? data?.key ?? data?.apiKey ?? null;
                if (value == null || String(value) === '')
                    return { error: 'mcp: секрет ' + filename + ' пуст (нужно поле value/token/key в #secret/' + filename + ')' };
                vars[k] = String(value);
            }
            catch (e) {
                return { error: 'mcp: нет секрета ' + filename + ' (#secret): ' + String(e.message || e) };
            }
        }
        else {
            vars[k] = s;
        }
    }
    return { vars };
}

/** Канал JSON-RPC поверх stdio: строки-ответы по id, запросы сервера — отказом. */
function mcpChannel(child) {
    let seq = 1;
    const pending = new Map();
    let buf = '';
    let stderr = '';
    child.stdout.on('data', chunk => {
        buf += String(chunk);
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i).trim();
            buf = buf.slice(i + 1);
            if (!line)
                continue;
            let msg;
            try {
                msg = JSON.parse(line);
            }
            catch {
                continue; // мусор сервера — не протокол
            }
            if (msg.id != null && pending.has(msg.id)) {
                const { resolve, reject } = pending.get(msg.id);
                pending.delete(msg.id);
                if (msg.error)
                    reject(new Error(msg.error.message || JSON.stringify(msg.error)));
                else
                    resolve(msg.result);
            }
            else if (msg.id != null && msg.method) {
                // Запрос сервера (roots/sampling): не поддерживаем — честный отказ, не вис.
                child.stdin.write(JSON.stringify({
                    jsonrpc: '2.0', id: msg.id,
                    error: { code: -32601, message: 'not supported by work-mcp' },
                }) + '\n');
            }
        }
    });
    child.stderr.on('data', chunk => {
        stderr += String(chunk);
        if (stderr.length > 2000)
            stderr = stderr.slice(-2000);
    });
    const failAll = e => {
        for (const { reject } of pending.values()) {
            try {
                reject(e);
            }
            catch { /* слушатель ушёл */ }
        }
        pending.clear();
    };
    child.on('error', failAll);
    child.on('exit', () => failAll(new Error('процесс MCP завершён')));
    return {
        notify(method, params) {
            try {
                child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params: params || {} }) + '\n');
            }
            catch { /* некому слушать */ }
        },
        request(method, params, timeout) {
            return new Promise((resolve, reject) => {
                const id = seq++;
                const timer = setTimeout(() => {
                    pending.delete(id);
                    reject(new Error('таймаут ' + timeout + 'мс; stderr: ' + (stderr.trim().slice(-300) || '—')));
                }, timeout);
                pending.set(id, {
                    resolve: v => { clearTimeout(timer); resolve(v); },
                    reject: e => { clearTimeout(timer); reject(e); },
                });
                try {
                    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params: params || {} }) + '\n');
                }
                catch (e) {
                    pending.delete(id);
                    clearTimeout(timer);
                    reject(e);
                }
            });
        },
    };
}

