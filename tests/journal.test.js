/**
 * Этап 11.1: журнал проводок — строки по парам (entry, rule), фильтры, сторно.
 */
import '../sources/reactor.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { $server } from '../sources/server/server.js';
import { invoke } from '../sources/server/access/gateway.js';
import { closeIndexDb } from '../sources/host/index-db.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const ADMIN = 'JA000000000001', USER1 = 'JU000000000001', NOBODY = 'JN000000000001';
let tmp, prev;
const as = uid => ({ session: { uid, principal: { kind: 'user', id: uid } } });

function write(rel, content) {
    const full = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf-8');
}

function copy(rel) {
    write(rel, fs.readFileSync(path.join(ROOT, rel), 'utf-8'));
}

const SALE = `METADATA: {
    FIELDS: [
        { id: 'name', required: true }, { id: 'time', type: 'timestamp' },
        { id: 'sum', type: 'Number', required: true },
    ],
    POSTINGS: [{ id: 'main', amount: 'sum',
        debit: { account: '/DATA/REGISTER/62' }, credit: { account: '/DATA/REGISTER/90' } }],
}`;

before(async () => {
    prev = process.cwd();
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-journal-'));
    write('$server/class.js', `export default { label: 'WORK', '#security': { ADMINS: ['${ADMIN}'] } }`);
    for (const p of ['$server/$folder', '$server/$folder/$class', '$server/$folder/$file'])
        write(p + '/class.js', 'export default {}');
    write('$server/$folder/$file/$data/class.js', `export default { isDataFile: true, METADATA: { FIELDS: [{ id: 'name' }] } }`);
    for (const [uid, label] of [[ADMIN, 'Админ'], [USER1, 'Бухгалтер'], [NOBODY, 'Чужой']])
        write(`USERS/${uid}/$user/class.js`, `export default { label: '${label}' }`);
    copy('DATA/REGISTER/$register/class.js');
    copy('DATA/REGISTER/$register/$folder/$class/$account/class.js');
    copy('DATA/REGISTER/$register/$folder/$class/$register/class.js');
    copy('DATA/OPERATIONS/$operation/class.js');
    copy('DATA/OPERATIONS/$operation/$folder/$class/$operation/class.js');
    process.chdir(tmp);
    globalThis.WORK = new $server();
    const reg = await WORK.get_item('/DATA/REGISTER');
    const admin = as(ADMIN);
    await reg.create({ id: '62', type: '$account', post: `export default { label: 'Расчёты', '#security': { USERS: ['${USER1}'] } }`, ...admin });
    await reg.create({ id: '90', type: '$account', post: `export default { label: 'Продажи', '#security': { USERS: ['${USER1}'] } }`, ...admin });
    const ops = await WORK.get_item('/DATA/OPERATIONS');
    await ops.create({ id: 'SALE', type: '$operation', post: `export default { label: 'Продажа', '#security': { USERS: ['${USER1}'] }, ${SALE} }`, ...admin });
    const sale = await WORK.get_item('/DATA/OPERATIONS/SALE');
    const o1 = await sale.create_object({ filename: 's1.data', post: { name: 'Счёт 1', sum: 1000 }, ...as(USER1) });
    await sale.post({ id: o1.id, ...as(USER1) });
    const o2 = await sale.create_object({ filename: 's2.data', post: { name: 'Счёт 2', sum: 500 }, ...as(USER1) });
    await sale.post({ id: o2.id, ...as(USER1) });
    await sale.unpost({ id: o2.id, ...as(USER1) });
});

after(async () => {
    await new Promise(r => setTimeout(r, 300));
    closeIndexDb();
    process.chdir(prev);
    try { await fsp.rm(tmp, { recursive: true, force: true }); } catch { /* windows */ }
});

describe('журнал', () => {
    it('строки по парам: счета, суммы, операция, сторно', async () => {
        const reg = await WORK.get_item('/DATA/REGISTER');
        const rows = await reg.journal(as(USER1));
        assert.equal(rows.length, 2);
        const [first, second] = rows;
        assert.equal(first.debit_account, '/DATA/REGISTER/62');
        assert.equal(first.credit_account, '/DATA/REGISTER/90');
        assert.equal(first.debit_label, 'Расчёты');
        assert.equal(first.op, 'Счёт 2');
        assert.equal(first.sum, 500);
        assert.equal(first.storno, true);
        assert.equal(first.n, 4, 'пара + сторно-пара');
        assert.equal(second.op, 'Счёт 1');
        assert.equal(second.sum, 1000);
        assert.equal(second.storno, false);
        assert.ok(first.time >= second.time, 'сначала новые');
    });

    it('фильтры: счёт, операция, лимит', async () => {
        const reg = await WORK.get_item('/DATA/REGISTER');
        assert.equal((await reg.journal({ account: '/DATA/REGISTER/62', ...as(USER1) })).length, 2);
        assert.equal((await reg.journal({ account: '/DATA/REGISTER/90', ...as(USER1) })).length, 2);
        assert.equal((await reg.journal({ account: '/DATA/REGISTER/99', ...as(USER1) })).length, 0);
        assert.equal((await reg.journal({ source: 'SALE', ...as(USER1) })).length, 2);
        assert.equal((await reg.journal({ source: 'XXX', ...as(USER1) })).length, 0);
        assert.equal((await reg.journal({ limit: 1, ...as(USER1) })).length, 1);
    });

    it('фильтр периода', async () => {
        const reg = await WORK.get_item('/DATA/REGISTER');
        const all = await reg.journal(as(USER1));
        assert.ok(all.length > 0);
        const day = new Date(all[0].time);
        const past = new Date(day.getTime() - 86400000).toISOString().slice(0, 10);
        const future = new Date(day.getTime() + 86400000).toISOString().slice(0, 10);
        assert.equal((await reg.journal({ from: past, to: future, ...as(USER1) })).length, all.length);
        assert.equal((await reg.journal({ from: future, ...as(USER1) })).length, 0);
    });

    it('чужому — пусто напрямую и запрет через шлюз', async () => {
        const reg = await WORK.get_item('/DATA/REGISTER');
        assert.deepEqual(await reg.journal(as(NOBODY)), []);
        await assert.rejects(invoke(reg, 'journal', as(NOBODY)), /Доступ запрещён/);
        const rows = await invoke(reg, 'journal', as(USER1));
        assert.equal(rows.length, 2);
    });
});
