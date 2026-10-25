/** Пул stdio MCP: один процесс на серию вызовов, параллельные запросы, перезапуск после падения. */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

process.env.WORK_812_CANARY ??= 'утечка-сервера'; // канарейка окружения: пул обязан её НЕ отдавать
process.env.WORK_MCP_MAX_LINE ??= '2048';         // тестовый потолок строки stdout (F20)
const pool = await import('../sources/modules/agent/mcp-pool.js');

const cfg = { command: process.execPath, args: [path.resolve(import.meta.dirname, 'fixtures/fake-mcp.mjs')] };
const text = r => r.content.map(c => c.text).join('');

after(() => pool.closeAll());

describe('mcp-pool', () => {
    it('два вызова — один процесс, initialize один раз', async () => {
        const a = text(await pool.rpc(cfg, 'tools/call', { name: 'pid' }));
        const b = text(await pool.rpc(cfg, 'tools/call', { name: 'pid' }));
        assert.equal(a, b);
        assert.equal(pool.size(), 1);
        const list = await pool.rpc(cfg, 'tools/list', {});
        assert.equal(list.tools[0].name, 'echo');
    });

    it('параллельные запросы в одном канале не путаются', async () => {
        const res = await Promise.all([1, 2, 3, 4].map(n => pool.rpc(cfg, 'tools/call', { name: 'slow', arguments: { n } })));
        assert.deepEqual(res.map(text), ['slow 1', 'slow 2', 'slow 3', 'slow 4']);
    });

    it('падение процесса — ошибка вызова, следующий вызов поднимает новый', async () => {
        const before = pool.pidOf(cfg);
        await assert.rejects(() => pool.rpc(cfg, 'tools/call', { name: 'crash' }), /завершён/);
        const pid = text(await pool.rpc(cfg, 'tools/call', { name: 'pid' }));
        assert.notEqual(String(before), pid);
    });

    it('запрос roots/list сервера: отвечаем корнями места задачи (не -32601)', async () => {
        const roots = [{ uri: 'work:/ORG/Отдел продаж', name: '/ORG/Отдел продаж' }];
        const r = text(await pool.rpc(cfg, 'tools/call', { name: 'roots' }, 30_000, { roots }));
        assert.match(r, /roots \{"roots":\[\{"uri":"work:\/ORG\/Отдел продаж"/);
    });

    it('roots/list без места задачи — пустые корни; чужой запрос сервера — честный -32601', async () => {
        // отдельный процесс: корни — на канал, место задачи держится между вызовами одного канала
        const cfg2 = { command: process.execPath, args: [...cfg.args, '--fresh'] };
        const r = text(await pool.rpc(cfg2, 'tools/call', { name: 'roots' }, 30_000));
        assert.match(r, /"roots":\[\]/);
        const a = text(await pool.rpc(cfg2, 'tools/call', { name: 'ask' }, 30_000, { roots: [{ uri: 'work:/ORG', name: '/ORG' }] }));
        assert.match(a, /ask \{"code":-32601,"message":"not supported by work-mcp"\}/);
        pool.closeAll();
    });

    it('initialize объявляет roots и шлёт notifications/initialized', async () => {
        const r = text(await pool.rpc(cfg, 'tools/call', { name: 'caps' }, 30_000));
        assert.match(r, /"roots":\{"listChanged":false\}/);
        assert.match(r, /"notified":1/);
    });

    it('ошибка метода — исключение с текстом сервера', async () => {
        await assert.rejects(() => pool.rpc(cfg, 'nope/x', {}), /no nope\/x/);
    });

    // ── F20 (final 8.12) ──────────────────────────────────────────────────────

    it('окружение: серверу — только базовый безопасный набор, без переменных сервера WORK (F20)', async () => {
        pool.closeAll();
        const r = JSON.parse(text(await pool.rpc(cfg, 'tools/call', { name: 'env' })));
        assert.equal(r.canary, null, 'переменная сервера утекла в MCP-процесс');
        assert.equal(r.path, true, 'PATH нужен для запуска');
        // envPass — явное расширение конфигом
        const withPass = { ...cfg, envPass: ['WORK_812_CANARY'] };
        const r2 = JSON.parse(text(await pool.rpc(withPass, 'tools/call', { name: 'env' })));
        assert.equal(r2.canary, 'утечка-сервера', 'envPass не передал переменную');
        // env конфига — поверх (секреты сервиса подставляет class.js)
        const withEnv = { ...cfg, env: { WORK_812_CANARY: 'секрет-сервиса' } };
        const r3 = JSON.parse(text(await pool.rpc(withEnv, 'tools/call', { name: 'env' })));
        assert.equal(r3.canary, 'секрет-сервиса', 'env конфига не передан');
        pool.closeAll();
    });

    it('изоляция: процесс на вызывающего — разные пользователи не делят канал и roots (F20)', async () => {
        pool.closeAll();
        const alice = { ...cfg };
        const bob = { ...cfg, args: [...cfg.args, '--fresh'] };
        const a1 = text(await pool.rpc(alice, 'tools/call', { name: 'pid' }, 30_000, { owner: 'EU00000000000001' }));
        const a2 = text(await pool.rpc(alice, 'tools/call', { name: 'pid' }, 30_000, { owner: 'EU00000000000001' }));
        assert.equal(a1, a2, 'один владелец — один и тот же процесс');
        const b1 = text(await pool.rpc(bob, 'tools/call', { name: 'pid' }, 30_000, { owner: 'EU00000000000002' }));
        assert.notEqual(a1, b1, 'разные владельцы — обязаны быть в разных процессах');
        // разные владельцы с ОДИНАКОВЫМ конфигом — тоже разные процессы
        pool.closeAll();
        const x = text(await pool.rpc(cfg, 'tools/call', { name: 'pid' }, 30_000, { owner: 'EU00000000000001' }));
        const y = text(await pool.rpc(cfg, 'tools/call', { name: 'pid' }, 30_000, { owner: 'EU00000000000002' }));
        assert.notEqual(x, y, 'один конфиг на двоих — общий процесс');
        const z = text(await pool.rpc(cfg, 'tools/call', { name: 'pid' }, 30_000, { owner: 'EU00000000000001' }));
        assert.equal(x, z, 'свой процесс переиспользуется');
        pool.closeAll();
    });

    it('потолок строки stdout: мусор не рвёт канал, гигантская строка отбрасывается (F20)', async () => {
        pool.closeAll();
        // мусорная строка под потолком — пропущена, ответ доходит
        const r = text(await pool.rpc(cfg, 'tools/call', { name: 'flood', arguments: { junk: 1024 } }, 30_000));
        assert.equal(r, 'flood done');
        // валидная строка JSON над потолком (4096 > 2048) — сброшена: rpc не получает ответ
        await assert.rejects(
            () => pool.rpc(cfg, 'tools/call', { name: 'longline' }, 1500),
            /таймаут/,
            'строка над потолком дошла до разбора — потолок не работает');
        pool.closeAll();
    });

    it('проводка: $service передаёт вызывающего в пул (F20) — изоляция доходит до class.js', async () => {
        const { pathToFileURL } = await import('node:url');
        const svc = await import(pathToFileURL(path.resolve(import.meta.dirname, '../SERVICES/$service/class.js')).href);
        const captured = [];
        const prev = globalThis.WORK_MCP;
        globalThis.WORK_MCP = async () => ({
            rpc: (rpcCfg, method, params, timeout, opts) => {
                captured.push({ owner: opts?.owner, envPass: rpcCfg?.envPass });
                return { result: { content: [{ type: 'text', text: 'ok' }] } };
            },
        });
        try {
            const owner = { path: '/SERVICES/Fake', mcp: { command: 'fake-cmd' } };
            const r = await svc.default.mcp_call_tool.call(owner, {
                name: 'x', arguments: {}, place: '/ORG', session: { uid: 'EU00000000000001' },
            });
            assert.equal(r.content[0].text, 'ok');
            assert.deepEqual(captured.map(c => c.owner), ['EU00000000000001'], 'вызывающий не дошёл до пула');
            const shared = await svc.default.mcp_list_tools.call(owner, {});
            assert.ok(shared, 'list сломался');
            assert.deepEqual(captured.map(c => c.owner), ['EU00000000000001', 'shared'], 'без сессии — shared');
        }
        finally {
            globalThis.WORK_MCP = prev;
        }
    });
});
