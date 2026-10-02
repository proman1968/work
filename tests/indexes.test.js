/**
 * Индексы: turnover/state/table/lookup, подъём к предкам, balance, rebuild, split.
 */
import '../sources/reactor.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { $server } from '../sources/server/server.js';
import { closeIndexDb } from '../sources/host/index-db.js';

const ADMIN = 'IA000000000001', USER1 = 'IU000000000001';
let tmp, prev;
const as = uid => ({ session: { uid, principal: { kind: 'user', id: uid } } });

function write(rel, content) {
    const full = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf-8');
}

const SCHEMA = `METADATA: { FIELDS: [
    { id: 'name', required: true }, { id: 'time', type: 'timestamp', required: true },
    { id: 'code', required: true }, { id: 'price', type: 'Number' }, { id: 'inn' },
], INDEXES: [
    { id: 'sales', kind: 'turnover', by: ['code'], measures: { price: 'sum', count: 'count' } },
    { id: 'stock', kind: 'state', by: ['code'], measures: { price: 'sum' } },
    { id: 'inn', kind: 'lookup', key: 'inn', unique: true },
    { id: 'bal', kind: 'balance', from: 'sales' },
] }`;

before(async () => {
    prev = process.cwd();
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-index-'));
    write('$server/class.js', `export default { label: 'WORK', '#security': { ADMINS: ['${ADMIN}'] } }`);
    for (const p of ['$server/$folder', '$server/$folder/$class', '$server/$folder/$file'])
        write(p + '/class.js', 'export default {}');
    write('$server/$folder/$file/$data/class.js', `export default { isDataFile: true, METADATA: { FIELDS: [{ id: 'name' }] } }`);
    for (const [uid, label] of [[ADMIN, 'Админ'], [USER1, 'Исполнитель']])
        write(`USERS/${uid}/$user/class.js`, `export default { label: '${label}' }`);
    write('INV/$class/class.js', `export default { label: 'Склад', '#security': { USERS: ['${USER1}'] }, ${SCHEMA} }`);
    write('INV/$class/$folder/$class/class.js', `export default { ${SCHEMA} }`);
    write('INV/SEC/$class/class.js', `export default { label: 'Секция', '#security': { USERS: ['${USER1}'] } }`);
    write('LVL/$class/class.js', `export default { label: 'Уровень', '#security': { USERS: ['${USER1}'] }, ${SCHEMA} }`);
    write('LVL/$class/$folder/$class/class.js', `export default { ${SCHEMA} }`);
    write('LVL/EMPTY/$class/class.js', `export default { label: 'Пусто' }`);
    write('LVL/$class/DATA/2026-09-03/1788000000003.X.data', JSON.stringify({ name: 'Старый', time: 1788000000003, code: 'OLD', price: 7 }));
    process.chdir(tmp);
    globalThis.WORK = new $server();
});

after(async () => {
    await new Promise(r => setTimeout(r, 300));
    closeIndexDb();
    process.chdir(prev);
    try { await fsp.rm(tmp, { recursive: true, force: true }); } catch { /* windows */ }
});

describe('индексы', () => {
    let id1;

    it('turnover/state/table: запись строит день/месяц/год и current', async () => {
        const sec = await WORK.get_item('/INV/SEC');
        const r1 = await sec.create_object({ filename: 'a.data', post: { name: 'A', code: 'A1', price: 100, inn: '111' }, ...as(USER1) });
        id1 = r1.id;
        const day = fs.readdirSync(path.join(tmp, 'INV/SEC/$class/DATA')).find(f => /^\d{4}-\d{2}-\d{2}$/.test(f));
        const rows = await sec.index({ id: 'sales', ...as(USER1) });
        assert.deepEqual(rows.total, { price: 100, count: 1 });
        assert.deepEqual(rows.rows[0].fields, { code: 'A1' });
        assert.ok(fs.existsSync(path.join(tmp, 'INV/SEC/$class/INDEX/sales', day + '.json')), 'файл дня');
        assert.ok(fs.existsSync(path.join(tmp, 'INV/SEC/$class/INDEX/sales', day.slice(0, 7) + '.json')), 'файл месяца');
        assert.ok(fs.existsSync(path.join(tmp, 'INV/SEC/$class/INDEX/sales', day.slice(0, 4) + '.json')), 'файл года');
        const st = await sec.index({ id: 'stock', ...as(USER1) });
        assert.deepEqual(st.total, { price: 100 });
        const tb = await sec.index({ id: 'table', ...as(USER1) });
        assert.equal(tb.total.count, 1);
        assert.equal(tb.rows[0].code, 'A1');
        assert.equal(tb.rows[0].id, id1);
        const lk = await sec.index({ id: 'inn', ...as(USER1) });
        assert.deepEqual(lk.rows, [{ key: '111', ids: [id1] }]);
        const inv = await WORK.get_item('/INV');
        assert.deepEqual((await inv.index({ id: 'sales', ...as(USER1) })).total, { price: 100, count: 1 }, 'подъём к предку');
    });

    it('правка и удаление — дельты, unique запрещает дубль', async () => {
        const sec = await WORK.get_item('/INV/SEC');
        await sec.update_object({ id: id1, post: { price: 150 }, ...as(USER1) });
        assert.deepEqual((await sec.index({ id: 'sales', ...as(USER1) })).total, { price: 150, count: 1 });
        assert.deepEqual((await sec.index({ id: 'stock', ...as(USER1) })).total, { price: 150 });
        const inv = await WORK.get_item('/INV');
        assert.deepEqual((await inv.index({ id: 'sales', ...as(USER1) })).total, { price: 150, count: 1 });
        await assert.rejects(
            sec.create_object({ filename: 'b.data', post: { name: 'B', code: 'A1', price: 10, inn: '111' }, ...as(USER1) }),
            /дубль ключа/);
        await sec.delete_object({ id: id1, ...as(USER1) });
        assert.deepEqual((await sec.index({ id: 'sales', ...as(USER1) })).total, {});
        assert.deepEqual((await sec.index({ id: 'stock', ...as(USER1) })).total, {});
        assert.equal((await sec.index({ id: 'table', ...as(USER1) })).total.count, 0);
        assert.equal((await sec.index({ id: 'inn', ...as(USER1) })).rows.length, 0);
        assert.deepEqual((await inv.index({ id: 'sales', ...as(USER1) })).total, {});
    });

    it('подъём к предкам и balance', async () => {
        const sec = await WORK.get_item('/INV/SEC');
        await sec.create_object({ filename: 'c.data', post: { name: 'C', code: 'C1', price: 40 }, ...as(USER1) });
        const inv = await WORK.get_item('/INV');
        assert.deepEqual((await inv.index({ id: 'sales', ...as(USER1) })).total, { price: 40, count: 1 });
        const bal = await inv.index({ id: 'bal', ...as(USER1) });
        assert.deepEqual(bal.total, { price: 40, count: 1 });
        assert.equal(bal.kind, 'balance');
    });

    it('rebuild после потери и смены описания', async () => {
        const inv = await WORK.get_item('/INV');
        fs.rmSync(path.join(tmp, 'INV/$class/INDEX'), { recursive: true, force: true });
        assert.deepEqual((await inv.index({ id: 'sales', ...as(USER1) })).total, {}, 'без файлов — пусто');
        const r = await inv.rebuild_index({ id: 'sales', ...as(ADMIN) });
        assert.equal(r.rebuilt, true);
        assert.deepEqual((await inv.index({ id: 'sales', ...as(USER1) })).total, { price: 40, count: 1 });
        await assert.rejects(inv.rebuild_index({ id: 'sales', ...as(USER1) }), /Доступ запрещён/);
        fs.writeFileSync(path.join(tmp, 'INV/$class/INDEX/sales/.meta.json'), JSON.stringify({ defHash: 'stale' }));
        await assert.rejects(inv.index({ id: 'sales', ...as(USER1) }), /устарел/);
        await inv.rebuild_index({ id: 'sales', ...as(ADMIN) });
        assert.deepEqual((await inv.index({ id: 'sales', ...as(USER1) })).total, { price: 40, count: 1 });
    });

    it('split переносит индекс', async () => {
        const lvl = await WORK.get_item('/LVL');
        const res = await lvl.split({ child: 'EMPTY', ...as(ADMIN) });
        assert.ok(res, 'факт split записан');
        assert.equal(fs.existsSync(path.join(tmp, 'LVL/$class/DATA')), false);
        const empty = await WORK.get_item('/LVL/EMPTY');
        assert.deepEqual((await empty.index({ id: 'sales', ...as(ADMIN) })).total, { price: 7, count: 1 });
        assert.deepEqual((await lvl.index({ id: 'sales', ...as(ADMIN) })).total, { price: 7, count: 1 }, 'родитель видит через потомка');
    });
});
