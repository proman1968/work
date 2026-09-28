/** Пул stdio MCP: один процесс на серию вызовов, параллельные запросы, перезапуск после падения. */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import * as pool from '../sources/modules/agent/mcp-pool.js';

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

    it('ошибка метода — исключение с текстом сервера', async () => {
        await assert.rejects(() => pool.rpc(cfg, 'nope/x', {}), /no nope\/x/);
    });
});
