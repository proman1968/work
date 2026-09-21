/**
 * $service — корневой тип внешних сервисов-коннекторов.
 *
 * METADATA содержит поля для настройки подключения.
 * Методы сервиса (methods/) доступны ИИ как функции (function calling).
 *
 * MCP-провайдеры (stdio): наследники задают `mcp: { command, args, env }`
 * в своём class.js и получают клиент бесплатно: `mcp_list_tools` /
 * `mcp_call_tool`. Токены — только `secret:ФАЙЛ` (резолв через read_secret),
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

/** Один JSON-RPC обмен с MCP-сервером поверх stdio: spawn → initialize → method → kill. */
async function mcpRpc(owner, method, params) {
    const cfg = owner?.mcp || {};
    let command = String(cfg.command || '').trim();
    const args = Array.isArray(cfg.args) ? cfg.args.map(String) : [];
    if (!command)
        return { error: 'mcp: нет mcp.command в class.js провайдера' };
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

/** Переменные окружения: `secret:ФАЙЛ` резолвятся через read_secret владельца. */
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

