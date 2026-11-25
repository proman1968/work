/**
 * Лёгкий JSON-RPC 2.0 MCP-сервер по stdio (NDJSON) для встроенных коннекторов WORK.
 * Совместим со спецификацией MCP 2025-06-18 и пулом `sources/modules/agent/mcp-pool.js`.
 */
import readline from 'node:readline';

export function startMcpStdioServer({ name, version = '1.0.0', tools = [] }) {
    const toolMap = new Map();
    for (const t of tools) {
        if (t?.name)
            toolMap.set(t.name, t);
    }

    const send = (obj) => {
        process.stdout.write(JSON.stringify(obj) + '\n');
    };

    const rl = readline.createInterface({
        input: process.stdin,
        crlfDelay: Infinity,
    });

    rl.on('line', async (rawLine) => {
        const line = String(rawLine || '').trim();
        if (!line)
            return;
        let msg;
        try {
            msg = JSON.parse(line);
        }
        catch {
            return;
        }
        if (!msg || typeof msg !== 'object')
            return;
        const { id, method, params } = msg;

        // Уведомления (без id) не требуют ответа
        if (id == null)
            return;

        try {
            if (method === 'initialize') {
                send({
                    jsonrpc: '2.0',
                    id,
                    result: {
                        protocolVersion: params?.protocolVersion || '2025-06-18',
                        capabilities: { tools: { listChanged: false } },
                        serverInfo: { name, version },
                    },
                });
                return;
            }
            if (method === 'ping') {
                send({ jsonrpc: '2.0', id, result: {} });
                return;
            }
            if (method === 'tools/list') {
                send({
                    jsonrpc: '2.0',
                    id,
                    result: {
                        tools: tools.map(t => ({
                            name: t.name,
                            description: t.description || '',
                            inputSchema: t.inputSchema || { type: 'object', properties: {} },
                        })),
                    },
                });
                return;
            }
            if (method === 'tools/call') {
                const toolName = String(params?.name || '').trim();
                const tool = toolMap.get(toolName);
                if (!tool) {
                    send({
                        jsonrpc: '2.0',
                        id,
                        error: { code: -32601, message: `Неизвестный инструмент MCP: ${toolName}` },
                    });
                    return;
                }
                const out = await tool.handler(params?.arguments || {});
                const isError = Boolean(out?.error && !out?.notConfigured);
                const text = typeof out === 'string' ? out : JSON.stringify(out, null, 2);
                send({
                    jsonrpc: '2.0',
                    id,
                    result: {
                        content: [{ type: 'text', text }],
                        ...(isError ? { isError: true } : {}),
                    },
                });
                return;
            }
            send({
                jsonrpc: '2.0',
                id,
                error: { code: -32601, message: `Метод ${method} не поддерживается` },
            });
        }
        catch (err) {
            send({
                jsonrpc: '2.0',
                id,
                result: {
                    content: [{ type: 'text', text: JSON.stringify({ error: String(err?.message || err) }, null, 2) }],
                    isError: true,
                },
            });
        }
    });
}
