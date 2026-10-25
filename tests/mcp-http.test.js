/**
 * Remote MCP-клиент WORK (SERVICES/$service, hardening 3.4): переиспользование Mcp-Session-Id на сервис
 * (один initialize на серию вызовов, сброс и один повтор при 404/400 «session»), roots/list → место задачи
 * (не -32601), честный отказ на чужие запросы сервера, секреты `secret:ФАЙЛ` в headers.
 * Настоящий HTTP-сервер (Streamable HTTP, JSON и SSE) и настоящий класс $service.
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import $service from '../SERVICES/$service/class.js';

let server, base;
const state = {};

before(async () => {
    server = http.createServer((req, res) => {
        let body = '';
        req.setEncoding('utf8');
        req.on('data', c => { body += c; });
        req.on('end', () => {
            let m = null;
            try { m = JSON.parse(body || '{}'); } catch { /* мусор */ }
            const json = (status, obj, headers = {}) => {
                res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
                res.end(JSON.stringify(obj));
            };
            if (!m || typeof m !== 'object' || m.jsonrpc !== '2.0')
                return json(400, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } });
            if (m.method == null && m.id != null) {
                // ответ клиента на наш запрос (roots/…): ждём его — отдаём тем, кто спросил
                state.asked?.(m);
                res.writeHead(202);
                return res.end();
            }
            if (m.method === 'initialize') {
                state.inits++;
                const sid = 's' + state.inits;
                state.sids.push(sid);
                state.caps = m.params?.capabilities || null;
                state.auth = req.headers.authorization;
                return json(200, { jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'test-mcp' } } }, { 'Mcp-Session-Id': sid });
            }
            if (m.method === 'notifications/initialized') {
                state.notified++;
                res.writeHead(202);
                return res.end();
            }
            if (state.requireAuth && req.headers.authorization !== 'Bearer sekret')
                return json(401, { jsonrpc: '2.0', id: m.id, error: { code: -32000, message: 'нужна авторизация' } });
            const sid = req.headers['mcp-session-id'];
            if (!sid)
                return json(400, { jsonrpc: '2.0', id: m.id, error: { code: -32000, message: 'Нужен заголовок Mcp-Session-Id (выдан в ответе на initialize)' } });
            if (sid !== state.sids.at(-1))
                return json(404, { jsonrpc: '2.0', id: m.id, error: { code: -32001, message: 'Сессия не найдена: выполните initialize заново' } });
            if (m.method !== 'tools/call')
                return json(404, { jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'no ' + m.method } });
            const { name, arguments: a = {} } = m.params || {};
            const ok = text => ({ content: [{ type: 'text', text }], isError: false });
            if (name === 'echo')
                return json(200, { jsonrpc: '2.0', id: m.id, result: ok('echo ' + a.text + ' sid=' + sid) });
            if (name === 'init-count')
                return json(200, { jsonrpc: '2.0', id: m.id, result: ok(JSON.stringify({ inits: state.inits, sids: state.sids, notified: state.notified, caps: state.caps, auth: state.auth })) });
            if (name === 'die-once') {
                state.killSid ??= sid; // умирает только первая сессия: повтор клиента на новой должен выжить
                if (sid === state.killSid && !state.killedOnce) {
                    state.killedOnce = true;
                    return json(404, { jsonrpc: '2.0', id: m.id, error: { code: -32001, message: 'Сессия не найдена: выполните initialize заново' } });
                }
                return json(200, { jsonrpc: '2.0', id: m.id, result: ok('resurrected sid=' + sid) });
            }
            if (name === 'ask-roots' || name === 'ask-unknown') {
                // SSE: запрос сервера клиенту (roots/list или sampling), потом ответ инструмента
                res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
                res.write('data: ' + JSON.stringify({ jsonrpc: '2.0', id: 'srv1', method: name === 'ask-roots' ? 'roots/list' : 'sampling/createMessage', params: {} }) + '\n\n');
                const timer = setTimeout(() => state.asked?.({ jsonrpc: '2.0', id: 'srv1', error: { code: -32000, message: 'таймаут' } }), 15_000);
                state.asked = ans => {
                    clearTimeout(timer);
                    const text = name + ' ' + JSON.stringify(ans.result ?? ans.error);
                    res.write('data: ' + JSON.stringify({ jsonrpc: '2.0', id: m.id, result: ok(text) }) + '\n\n');
                    res.end();
                };
                return;
            }
            return json(200, { jsonrpc: '2.0', id: m.id, result: ok('ok ' + name) });
        });
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    base = 'http://127.0.0.1:' + server.address().port + '/mcp';
});

beforeEach(() => {
    Object.assign(state, { inits: 0, sids: [], notified: 0, caps: null, auth: undefined, killSid: null, killedOnce: false, requireAuth: false, asked: null });
    globalThis.WORK_MCP_HTTP_SESSIONS?.clear();
});

after(() => server.close());

// ── клиент: $service.mcp_call_tool с фиктивным владельцем ────────────────────

let n = 0;
/** Владелец-сервис + функция вызова инструмента (place — место задачи, как в call агента). */
function make(mcp) {
    const owner = {
        path: '/SERVICES/t' + (++n),
        mcp,
        read_secret: async () => ({ value: 'Bearer sekret' }),
    };
    return (name, args = {}, place) =>
        $service.mcp_call_tool.call(owner, { name, arguments: args, place });
}

const text = r => r?.content?.map(c => c.text).join('\n') ?? JSON.stringify(r);

describe('remote MCP-клиент: сессия и roots', () => {
    it('сессия переиспользуется: один initialize на серию вызовов, notifications/initialized, capabilities.roots', async () => {
        const call = make({ url: base });
        assert.match(text(await call('echo', { text: 'x' })), /echo x sid=s1/);
        assert.match(text(await call('echo', { text: 'y' })), /echo y sid=s1/); // тот же sid — не переинициализация
        const info = JSON.parse(text(await call('init-count')));
        assert.equal(info.inits, 1);
        assert.equal(info.notified, 1);
        assert.deepEqual(info.caps.roots, { listChanged: false });
    });

    it('потеря сессии (404 «Сессия не найдена»): сброс, initialize заново, один повтор', async () => {
        const call = make({ url: base });
        assert.match(text(await call('echo', { text: '1' })), /sid=s1/);
        assert.match(text(await call('die-once')), /resurrected sid=s2/); // s1 «умерла» — повтор на новой
        assert.equal(JSON.parse(text(await call('init-count'))).inits, 2);
        assert.equal(JSON.parse(text(await call('init-count'))).inits, 2); // больше не переинициализирует
    });

    it('устаревший sid в кэше (404 «Сессия не найдена») — сброс, initialize, один повтор', async () => {
        const owner = { path: '/SERVICES/stale', mcp: { url: base }, read_secret: async () => ({ value: 'x' }) };
        globalThis.WORK_MCP_HTTP_SESSIONS.set(owner.path + '\n' + base, 'nope'); // сессия «пережила» рестарт сервера
        const r = await $service.mcp_call_tool.call(owner, { name: 'echo', arguments: { text: 'z' } });
        assert.match(text(r), /echo z sid=s1/);
        assert.equal(JSON.parse(text(await $service.mcp_call_tool.call(owner, { name: 'init-count' }))).inits, 1);
    });

    it('запрос roots/list сервера (SSE): место задачи, не -32601; без места — пустые корни', async () => {
        const call = make({ url: base });
        const r = await call('ask-roots', {}, '/ORG/Отдел продаж');
        assert.match(text(r), /ask-roots \{"roots":\[\{"uri":"work:\/ORG\/Отдел продаж","name":"\/ORG\/Отдел продаж"\}\]\}/);
        const bare = await call('ask-roots');
        assert.match(text(bare), /"roots":\[\]/);
    });

    it('чужой запрос сервера (sampling) — честный -32601, вызов не падает', async () => {
        const r = await make({ url: base })('ask-unknown');
        assert.match(text(r), /ask-unknown \{"code":-32601,"message":"not supported by work-mcp"\}/);
    });

    it('секрет из headers (secret:ФАЙЛ) доходит серверу; 401 — понятная ошибка про ключ', async () => {
        const withKey = make({ url: base, headers: { Authorization: 'secret:key.json' } });
        state.requireAuth = true;
        try {
            assert.equal(JSON.parse(text(await withKey('init-count'))).auth, 'Bearer sekret');
            const no = await make({ url: base })('echo', { text: 'z' });
            assert.match(no.error, /нужен ключ/);
        }
        finally {
            state.requireAuth = false;
        }
    });

    it('mcp_list_tools работает; ошибка сервера — с текстом сервера', async () => {
        const owner = { path: '/SERVICES/list', mcp: { url: base }, read_secret: async () => ({ value: 'x' }) };
        const list = await $service.mcp_list_tools.call(owner, {});
        assert.match(list.error, /no tools\/list/);
    });
});


// ── F21 (final 8.14): щит remote-MCP ────────────────────────────────────────

describe('F21: remote-MCP — редиректы, лимиты ответов, учётные данные в URL', () => {
    const mk = url => {
        const owner = { path: '/SERVICES/f21-' + Math.random().toString(36).slice(2, 6), mcp: { url }, read_secret: async () => ({ value: 'Bearer sekret' }) };
        return (name, args = {}, place) => $service.mcp_call_tool.call(owner, { name, arguments: args, place });
    };
    /** Минимальный MCP-сервер: initialize/notifications/echo + спец-методы F21. */
    function fakeMcp(extra = {}) {
        const hits = [];
        const srv = http.createServer((req, res) => {
            let body = '';
            req.setEncoding('utf8');
            req.on('data', c => { body += c; });
            req.on('end', () => {
                hits.push({ url: req.url, auth: req.headers.authorization || null });
                let m = null;
                try { m = JSON.parse(body || '{}'); } catch { /* мусор */ }
                const json = (status, obj, headers = {}) => {
                    res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
                    res.end(typeof obj === 'string' ? obj : JSON.stringify(obj));
                };
                if (m.method === 'initialize')
                    return json(200, { jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-06-18', serverInfo: { name: 'f21' }, capabilities: {} } });
                if (m.method === 'notifications/initialized')
                    return res.writeHead(202).end();
                if (m.method === 'tools/call') {
                    const name = m.params?.name;
                    if (extra.redirect)
                        return res.writeHead(302, { location: extra.redirect }).end();
                    if (name === 'big')
                        return json(200, { jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'B'.repeat(128 * 1024) }] } });
                    if (name === 'ssebig') {
                        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
                        return res.write('data: ' + 'X'.repeat(4096)); // событие без завершения — поток мусора
                    }
                    return json(200, { jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'echo ' + String(m.params?.arguments?.text || '') }] } });
                }
                json(400, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } });
            });
        });
        return { srv, hits };
    }
    const listen = s => new Promise(r => s.listen(0, '127.0.0.1', () => r('http://127.0.0.1:' + s.address().port)));
    const close = s => new Promise(r => s.close(r));

    it('редирект запрещён: заголовки подключения не уезжают на чужой адрес (F21)', async () => {
        const target = fakeMcp();
        const tbase = await listen(target.srv);
        const main = fakeMcp({ redirect: tbase + '/catch' });
        const mbase = await listen(main.srv);
        try {
            const res = await mk(mbase)('echo', { text: 'x' });
            // вызов обязан завершиться ошибкой (редирект не выполняется), а цель — не получить НИЧЕГО
            assert.ok(res?.error, 'редирект выполнился: ' + JSON.stringify(res).slice(0, 120));
            assert.equal(target.hits.length, 0, 'запрос с заголовками дошёл до чужого адреса');
        }
        finally {
            await close(main.srv);
            await close(target.srv);
        }
    });

    it('JSON-ответ сверх потолка — отказ, а не копление в памяти (F21)', async () => {
        process.env.WORK_MCP_HTTP_MAX = '65536';
        const f = fakeMcp();
        const b = await listen(f.srv);
        try {
            const res = await mk(b)('big');
            assert.ok(res?.error && /больше|МБ/i.test(res.error), 'гигантский ответ не оборван: ' + String(res?.error).slice(0, 120));
        }
        finally {
            delete process.env.WORK_MCP_HTTP_MAX;
            await close(f.srv);
        }
    });

    it('SSE-событие сверх потолка — отказ (F21)', async () => {
        process.env.WORK_MCP_SSE_MAX = '2048';
        const f = fakeMcp();
        const b = await listen(f.srv);
        try {
            const res = await mk(b)('ssebig');
            assert.ok(res?.error && /SSE-событие/i.test(res.error), 'мусорный SSE-поток не оборван: ' + String(res?.error).slice(0, 120));
        }
        finally {
            delete process.env.WORK_MCP_SSE_MAX;
            await close(f.srv);
        }
    });

    it('учётные данные в mcp.url — отказ до любого запроса (F21)', async () => {
        const res = await mk('http://user:pass@f21.invalid')('echo');
        assert.ok(res?.error && /учётн/i.test(res.error), 'URL с паролем принят: ' + String(res?.error).slice(0, 120));
    });
});
