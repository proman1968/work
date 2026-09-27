// Поддельный stdio MCP-сервер для тестов: tools/list, tools/call (echo, pid, crash).
import readline from 'node:readline';
const rl = readline.createInterface({ input: process.stdin });
const out = o => process.stdout.write(JSON.stringify(o) + '\n');
rl.on('line', line => {
    let m;
    try { m = JSON.parse(line); } catch { return; }
    if (m.method === 'initialize')
        return out({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2024-11-05', serverInfo: { name: 'fake' }, capabilities: { tools: {} } } });
    if (m.method === 'tools/list')
        return out({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'echo', description: 'echo', inputSchema: { type: 'object', properties: { text: { type: 'string' } } }, annotations: { readOnlyHint: true } }] } });
    if (m.method === 'tools/call') {
        const { name, arguments: args = {} } = m.params || {};
        if (name === 'crash')
            process.exit(3);
        if (name === 'slow')
            return setTimeout(() => out({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'slow ' + args.n }] } }), 50);
        return out({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: name === 'pid' ? String(process.pid) : 'echo ' + args.text }] } });
    }
    if (m.id != null)
        out({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'no ' + m.method } });
});
