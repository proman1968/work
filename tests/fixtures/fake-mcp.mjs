// Поддельный stdio MCP-сервер для тестов: tools/list, tools/call (echo, pid, crash, caps, roots, ask).
import readline from 'node:readline';
const rl = readline.createInterface({ input: process.stdin });
const out = o => process.stdout.write(JSON.stringify(o) + '\n');
const ok = (id, result) => out({ jsonrpc: '2.0', id, result });
let caps = null, notified = 0, srvSeq = 0;
const asked = new Map(); // id → resolve: ответы клиента на наши запросы
rl.on('line', line => {
    let m;
    try { m = JSON.parse(line); } catch { return; }
    if (m.method === 'initialize') {
        caps = m.params?.capabilities || null;
        return out({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2024-11-05', serverInfo: { name: 'fake' }, capabilities: { tools: {} } } });
    }
    if (m.method === 'notifications/initialized') {
        notified++;
        return;
    }
    // ответ клиента на наш запрос (roots/…)
    if (m.method == null && m.id != null && asked.has(m.id)) {
        asked.get(m.id)(m);
        asked.delete(m.id);
        return;
    }
    if (m.method === 'tools/list')
        return out({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'echo', description: 'echo', inputSchema: { type: 'object', properties: { text: { type: 'string' } } }, annotations: { readOnlyHint: true } }] } });
    if (m.method === 'tools/call') {
        const { name, arguments: args = {} } = m.params || {};
        if (name === 'crash')
            process.exit(3);
        if (name === 'caps')
            return ok(m.id, { content: [{ type: 'text', text: 'caps ' + JSON.stringify({ caps, notified }) }] });
        if (name === 'roots' || name === 'ask') {
            // запрос сервера клиенту (roots/list или sampling), потом ответ в результат инструмента
            const rid = 'srv' + (++srvSeq);
            out({ jsonrpc: '2.0', id: rid, method: name === 'roots' ? 'roots/list' : 'sampling/createMessage', params: {} });
            const p = new Promise(r => asked.set(rid, r));
            return setTimeout(() => p.then(ans => ok(m.id, { content: [{ type: 'text', text: name + ' ' + JSON.stringify(ans.result ?? ans.error) }] })), 0);
        }
        if (name === 'slow')
            return setTimeout(() => out({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'slow ' + args.n }] } }), 50);
        return out({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: name === 'pid' ? String(process.pid) : 'echo ' + args.text }] } });
    }
    if (m.id != null)
        out({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'no ' + m.method } });
});
