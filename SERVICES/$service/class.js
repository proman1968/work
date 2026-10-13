/**
 * $service — корневой тип внешних сервисов-коннекторов.
 *
 * METADATA содержит поля для настройки подключения.
 * Методы сервиса (methods/) доступны ИИ как функции (function calling).
 *
 * MCP-провайдеры двух видов (один класс сущности, разница в полях):
 * - локальные (stdio): `mcp: { command, args, env }` — процесс рядом;
 * - прокси (remote): `mcp: { url, headers }` — чужой HTTP-эндпоинт (сессия Mcp-Session-Id
 *   кэшируется на сервис, при 404/400 «session» — initialize заново и один повтор).
 * Оба получают клиент бесплатно: `mcp_list_tools` / `mcp_call_tool`.
 * На запрос сервера roots/list клиент отвечает корнями места задачи (place от call агента).
 * Токены — только `secret:ФАЙЛ` (резолв через read_secret),
 * открытым текстом в class.js запрещены.
 */
export default {
    icon: 'carbon:api',
    description: 'Внешние сервисы и коннекторы',

    METADATA: {
        STATIC: [{
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
    async mcp_list_tools(params = {}) {
        return mcpRpc(this, 'tools/list', {}, { place: params.place });
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
        }, { place: params.place });
        if (result?.error)
            return result;
        return result?.result ?? result;
    },
};

const MCP_START_TIMEOUT = 15000;
const MCP_CALL_TIMEOUT = 60000;

/** Один JSON-RPC обмен с MCP-сервером: stdio (spawn) или remote (HTTP). */
async function mcpRpc(owner, method, params, opts = {}) {
    const cfg = owner?.mcp || {};
    if (String(cfg.url || '').trim())
        return mcpHttpRpc(owner, method, params, opts);
    const command = String(cfg.command || '').trim();
    const args = Array.isArray(cfg.args) ? cfg.args.map(String) : [];
    if (!command)
        return { error: 'mcp: нет mcp.command (stdio) или mcp.url (remote) в class.js провайдера' };
    const env = await mcpEnv(owner, cfg.env);
    if (env.error)
        return env;
    // Пул ядра (sources/modules/agent/mcp-pool.js): процесс живёт между вызовами, initialize — один раз
    try {
        const pool = await WORK_MCP();
        return await pool.rpc({ command, args, env: env.vars, cwd: cfg.cwd }, method, params || {}, MCP_CALL_TIMEOUT, { roots: mcpRoots(opts) });
    }
    catch (e) {
        return { error: 'mcp ' + method + ': ' + String(e.message || e) };
    }
}

/** Кэш Mcp-Session-Id на сервис (класс грузится data:-модулем и пересоздаётся — держим в глобале):
 *  сессия переиспользуется между вызовами; 404/400 про сессию — сброс, initialize заново и один повтор. */
const SESSIONS = (globalThis.WORK_MCP_HTTP_SESSIONS ??= new Map());

/** initialize: объявляем roots (на roots/list сервера отвечаем корнями места задачи). */
const INIT_PARAMS = {
    protocolVersion: '2025-06-18',
    capabilities: { roots: { listChanged: false } },
    clientInfo: { name: 'work-mcp', version: '2.0.0' },
};

/** Ошибка «сессия потеряна» (наш сервер: 404/400 «Сессия не найдена» / «Mcp-Session-Id»). */
const isLostSession = e => (e?.status === 404 || e?.status === 400) && /session|сесси/i.test(String(e?.message || ''));

/** Корни WORK для запроса roots/list сервера: место задачи (place от call агента, не из аргументов модели). */
function mcpRoots(opts = {}) {
    const place = String(opts?.place || '').trim();
    return place ? [{ uri: 'work:' + place, name: place }] : [];
}

/** Remote MCP поверх Streamable HTTP: сессия кэшируется на сервис (сброс и повтор при потере),
 *  запросы сервера в SSE-потоке (roots/list → корни места задачи, остальное — честный отказ). */
async function mcpHttpRpc(owner, method, params, opts = {}) {
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
    const roots = mcpRoots(opts);
    const key = (owner?.path || '?') + '\n' + url;
    let seq = 0;

    /** Ответ серверу на его запрос (roots/list или отказ) — не роняет наш вызов. */
    const answer = async (msg, sessionId) => {
        const body = msg.method === 'roots/list'
            ? { jsonrpc: '2.0', id: msg.id, result: { roots } }
            : { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'not supported by work-mcp' } };
        try {
            await fetch(url, {
                method: 'POST',
                headers: sessionId ? { ...headers, 'Mcp-Session-Id': sessionId } : headers,
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(15_000),
            });
        }
        catch { /* ответ серверу не критичен для нашего вызова */ }
    };

    const notify = async (m, sessionId) => {
        try {
            await fetch(url, {
                method: 'POST',
                headers: sessionId ? { ...headers, 'Mcp-Session-Id': sessionId } : headers,
                body: JSON.stringify({ jsonrpc: '2.0', method: m }),
                signal: AbortSignal.timeout(10_000),
            });
        }
        catch { /* уведомление — не критично */ }
    };

    const call = async (m, p, sessionId, timeout = MCP_CALL_TIMEOUT) => {
        const res = await fetch(url, {
            method: 'POST',
            headers: sessionId ? { ...headers, 'Mcp-Session-Id': sessionId } : headers,
            body: JSON.stringify({ jsonrpc: '2.0', id: ++seq, method: m, params: p || {} }),
            signal: AbortSignal.timeout(timeout),
        });
        if (res.status === 401 || res.status === 403)
            throw new Error('HTTP ' + res.status + ' — нужен ключ (secret:ФАЙЛ в headers)');
        if (!res.ok) {
            let text = '';
            try { text = await res.text(); } catch { /* пусто */ }
            let msg = null;
            try { msg = JSON.parse(text); } catch { /* не JSON */ }
            const e = new Error(msg?.error?.message ? String(msg.error.message) : 'HTTP ' + res.status);
            e.status = res.status;
            throw e;
        }
        const sid = res.headers.get('mcp-session-id') || sessionId || null;
        if (!/event-stream/i.test(String(res.headers.get('content-type') || ''))) {
            const msg = parseHttpRpc(await res.text());
            if (!msg)
                throw new Error('пустой ответ');
            if (msg.error)
                throw new Error(msg.error.message || JSON.stringify(msg.error));
            return { result: msg.result, sessionId: sid };
        }
        // SSE-поток: запросы сервера (roots/list → корни места задачи) и наш ответ
        const dec = new TextDecoder();
        let buf = '';
        for await (const chunk of res.body) {
            buf = (buf + dec.decode(chunk, { stream: true })).replace(/\r\n/g, '\n');
            let i;
            while ((i = buf.indexOf('\n\n')) >= 0) {
                const raw = buf.slice(0, i);
                buf = buf.slice(i + 2);
                for (const line of raw.split('\n')) {
                    const t = line.trim();
                    if (!t.startsWith('data:'))
                        continue;
                    let msg;
                    try { msg = JSON.parse(t.slice(5).trim()); } catch { continue; }
                    if (!msg || typeof msg !== 'object')
                        continue;
                    if (msg.method && msg.id != null) {
                        await answer(msg, sid);
                        continue;
                    }
                    if (msg.error)
                        throw new Error(msg.error.message || JSON.stringify(msg.error));
                    return { result: msg.result, sessionId: sid };
                }
            }
        }
        throw new Error('поток закрыт без ответа');
    };

    const freshSession = async () => {
        const init = await call('initialize', INIT_PARAMS, null, MCP_START_TIMEOUT);
        if (init.sessionId) {
            if (SESSIONS.size >= 64) // не копим сессии исчезнувших сервисов
                SESSIONS.delete(SESSIONS.keys().next().value);
            SESSIONS.set(key, init.sessionId);
        }
        await notify('notifications/initialized', init.sessionId);
        return init.sessionId || null;
    };
    const once = async sid => {
        const out = await call(method, params, sid);
        return out.result ?? out;
    };
    try {
        let sid = SESSIONS.get(key) || null;
        if (!sid)
            sid = await freshSession();
        try {
            return await once(sid);
        }
        catch (e) {
            if (!isLostSession(e))
                throw e;
            SESSIONS.delete(key); // сессия умерла (перезапуск сервера): initialize заново и один повтор
            return await once(await freshSession());
        }
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
