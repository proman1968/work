/**
 * Этап 9: разноска post/unpost — 2×N проводок, сторно, компенсация.
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

const ROOT = path.resolve(import.meta.dirname, '..');
const ADMIN = 'PA000000000001', USER1 = 'PU000000000001';
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

const CATALOG = `METADATA: { FIELDS: [
    { id: 'name', required: true }, { id: 'time', type: 'timestamp' }, { id: 'inn' },
] }`;
const ACC62 = `METADATA: {
    FIELDS: [{ id: 'counterparty', type: 'Link', catalog: '/DATA/CATALOGS/CLIENTS', analytic: true }],
    INDEXES: [{ id: 'turnover', kind: 'turnover', by: ['counterparty'], measures: { debit: 'sum', credit: 'sum' } }],
}`;
const SALE = `METADATA: {
    FIELDS: [
        { id: 'name', required: true }, { id: 'time', type: 'timestamp' },
        { id: 'client', type: 'Link', catalog: '/DATA/CATALOGS/CLIENTS', required: true },
        { id: 'sum', type: 'Number', required: true },
    ],
    POSTINGS: [{ id: 'main', amount: 'sum',
        debit: { account: '/DATA/REGISTER/62', analytics: { counterparty: 'client' } },
        credit: { account: '/DATA/REGISTER/90' } }],
}`;

before(async () => {
    prev = process.cwd();
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-post-'));
    write('$server/class.js', `export default { label: 'WORK', '#security': { ADMINS: ['${ADMIN}'] } }`);
    for (const p of ['$server/$folder', '$server/$folder/$class', '$server/$folder/$file'])
        write(p + '/class.js', 'export default {}');
    write('$server/$folder/$file/$data/class.js', `export default { isDataFile: true, METADATA: { FIELDS: [{ id: 'name' }] } }`);
    for (const [uid, label] of [[ADMIN, 'Админ'], [USER1, 'Исполнитель']])
        write(`USERS/${uid}/$user/class.js`, `export default { label: '${label}' }`);
    copy('DATA/REGISTER/$register/class.js');
    copy('DATA/REGISTER/$register/$folder/$class/$account/class.js');
    copy('DATA/OPERATIONS/$operation/class.js');
    copy('DATA/OPERATIONS/$operation/$folder/$class/$operation/class.js');
    write('DATA/CATALOGS/$class/class.js', `export default { label: 'Справочники' }`);
    write('DATA/CATALOGS/CLIENTS/$class/class.js', `export default { label: 'Клиенты', '#security': { USERS: ['${USER1}'] }, ${CATALOG} }`);
    process.chdir(tmp);
    globalThis.WORK = new $server();
    const reg = await WORK.get_item('/DATA/REGISTER');
    const admin = as(ADMIN);
    await reg.create({ id: '62', type: '$account', post: `export default { label: 'Расчёты', icon: 'carbon:wallet', '#security': { USERS: ['${USER1}'] }, ${ACC62} }`, ...admin });
    await reg.create({ id: '90', type: '$account', post: `export default { label: 'Продажи', icon: 'carbon:wallet', '#security': { USERS: ['${USER1}'] } }`, ...admin });
    const ops = await WORK.get_item('/DATA/OPERATIONS');
    await ops.create({ id: 'SALE', type: '$operation', post: `export default { label: 'Продажа', '#security': { USERS: ['${USER1}'] }, ${SALE} }`, ...admin });
});

after(async () => {
    await new Promise(r => setTimeout(r, 300));
    closeIndexDb();
    process.chdir(prev);
    try { await fsp.rm(tmp, { recursive: true, force: true }); } catch { /* windows */ }
});

describe('разноска', () => {
    let clientId, opId;

    it('post: две проводки с общим entry, posted в операции', async () => {
        const clients = await WORK.get_item('/DATA/CATALOGS/CLIENTS');
        clientId = (await clients.create_object({ filename: 'a.data', post: { name: 'Альфа', inn: '1' }, ...as(USER1) })).id;
        const sale = await WORK.get_item('/DATA/OPERATIONS/SALE');
        opId = (await sale.create_object({ filename: 's1.data', post: { name: 'Счёт 1', client: clientId, sum: 1000 }, ...as(USER1) })).id;
        const res = await sale.post({ id: opId, ...as(USER1) });
        assert.match(String(res?.message || JSON.stringify(res)), /Проведено/);
        const acc62 = await WORK.get_item('/DATA/REGISTER/62');
        const acc90 = await WORK.get_item('/DATA/REGISTER/90');
        const d = await acc62.query({ ...as(USER1) });
        const c = await acc90.query({ ...as(USER1) });
        assert.equal(d.length, 1);
        assert.equal(c.length, 1);
        assert.equal(d[0].body.debit, 1000);
        assert.equal(d[0].body.credit, 0);
        assert.equal(d[0].body.counterparty, clientId);
        assert.equal(c[0].body.credit, 1000);
        assert.equal(d[0].body.entry, c[0].body.entry);
        assert.equal(c[0].body.corr_account, '/DATA/REGISTER/62');
        assert.equal(d[0].body.source, '/DATA/OPERATIONS/SALE/' + opId);
        const op = await sale.read_object({ id: opId, ...as(USER1) });
        assert.equal(op.body.posted.records.length, 2);
        const t = await acc62.index({ id: 'turnover', ...as(USER1) });
        assert.deepEqual(t.total, { debit: 1000 });
    });

    it('повторный post — сторно старых и новые записи', async () => {
        const sale = await WORK.get_item('/DATA/OPERATIONS/SALE');
        await sale.update_object({ id: opId, post: { sum: 1200 }, ...as(USER1) });
        await sale.post({ id: opId, ...as(USER1) });
        const acc62 = await WORK.get_item('/DATA/REGISTER/62');
        const all = await acc62.query({ order: 'asc', ...as(USER1) });
        assert.equal(all.length, 3, 'исходная + сторно + новая');
        assert.ok(all.some(x => x.body.storno && x.body.debit === -1000));
        const t = await acc62.index({ id: 'turnover', ...as(USER1) });
        assert.deepEqual(t.total, { debit: 1200 });
    });

    it('unpost replace удаляет записи', async () => {
        const sale = await WORK.get_item('/DATA/OPERATIONS/SALE');
        const before = (await sale.read_object({ id: opId, ...as(USER1) })).body.posted.records;
        assert.equal(before.length, 2);
        const r = await sale.unpost({ id: opId, mode: 'replace', ...as(USER1) });
        assert.deepEqual(r, { unposted: true, mode: 'replace' });
        const acc62 = await WORK.get_item('/DATA/REGISTER/62');
        for (const ref of before.filter(p => p.startsWith('/DATA/REGISTER/62/'))) {
            const rec = await acc62.read_object({ id: ref.split('/').pop(), ...as(USER1) });
            assert.equal(rec.body.deleted, true, 'текущая запись помечена');
        }
        const op = await sale.read_object({ id: opId, ...as(USER1) });
        assert.equal(op.body.posted, null);
    });

    it('post без счёта — ошибка и компенсация', async () => {
        const ops = await WORK.get_item('/DATA/OPERATIONS');
        await ops.create({ id: 'BAD', type: '$operation', post: `export default { label: 'Битый', '#security': { USERS: ['${USER1}'] },
            METADATA: { FIELDS: [{ id: 'name' }, { id: 'time' }, { id: 'client', type: 'Link', catalog: '/DATA/CATALOGS/CLIENTS' }, { id: 'sum', type: 'Number' }],
            POSTINGS: [{ id: 'main', amount: 'sum',
                debit: { account: '/DATA/REGISTER/62', analytics: { counterparty: 'client' } },
                credit: { account: '/DATA/REGISTER/99' } }] } }`, ...as(ADMIN) });
        const bad = await WORK.get_item('/DATA/OPERATIONS/BAD');
        const opId2 = (await bad.create_object({ filename: 'b.data', post: { name: 'Б', client: clientId, sum: 5 }, ...as(USER1) })).id;
        await assert.rejects(bad.post({ id: opId2, ...as(USER1) }), /нет счёта/);
        const acc62 = await WORK.get_item('/DATA/REGISTER/62');
        const all = await acc62.query({ include_deleted: true, ...as(USER1) });
        assert.ok(!all.some(x => x.body.source === '/DATA/OPERATIONS/BAD/' + opId2 && !x.body.deleted), 'частичная запись убрана');
    });
});
