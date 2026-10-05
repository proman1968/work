/**
 * Этап 11: сквозной контур — справочники, операции, счета, рабочее место, проводки, сальдо.
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
const ADMIN = 'EA000000000001', USER1 = 'EU000000000001';
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

const SEC = `'#security': { USER: ['${USER1}'] }`;

before(async () => {
    prev = process.cwd();
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-acc-'));
    write('$server/class.js', `export default { label: 'WORK', '#security': { ADMIN: ['${ADMIN}'] } }`);
    for (const p of ['$server/$folder', '$server/$folder/$class', '$server/$folder/$file'])
        write(p + '/class.js', 'export default {}');
    write('$server/$folder/$file/$data/class.js', `export default { isDataFile: true, METADATA: { FIELDS: [{ id: 'name' }] } }`);
    for (const [uid, label] of [[ADMIN, 'Админ'], [USER1, 'Продавец']])
        write(`USERS/${uid}/$user/class.js`, `export default { label: '${label}' }`);
    copy('DATA/REGISTER/$register/class.js');
    copy('DATA/REGISTER/$register/$folder/$class/$account/class.js');
    copy('DATA/OPERATIONS/$operation/class.js');
    copy('DATA/OPERATIONS/$operation/$folder/$class/$operation/class.js');
    copy('DATA/CATALOGS/$catalog/class.js');
    copy('DATA/CATALOGS/$catalog/$folder/$class/$catalog/class.js');
    write('BASE/direction/$group/class.js', `export default { label: 'Направления' }`);
    write('BASE/direction/sales/$group/class.js', `export default { label: 'Продажи', ${SEC},
        LINKS: [
            { id: '/DATA/OPERATIONS/ПРОДАЖА', access: 'write' },
            { id: '/DATA/OPERATIONS/ОПЛАТА', access: 'write' },
            { id: '/DATA/OPERATIONS/ПИСЬМО', access: 'write' },
            { id: '/DATA/CATALOGS/КОНТРАГЕНТЫ', access: 'write' },
            { id: '/DATA/REGISTER/62', access: 'read' },
            { id: '/DATA/REGISTER/90', access: 'read' },
            { id: '/DATA/REGISTER/51', access: 'read' },
            { id: '/DATA/REGISTER/ПИСЬМА', access: 'read' },
        ] }`);
    process.chdir(tmp);
    globalThis.WORK = new $server();
    const admin = as(ADMIN);
    const user = as(USER1);
    // справочник
    const cats = await WORK.get_item('/DATA/CATALOGS');
    await cats.create({ id: 'КОНТРАГЕНТЫ', type: '$catalog', post: `export default { label: 'Контрагенты', ${SEC},
        METADATA: { FIELDS: [{ id: 'name', required: true }, { id: 'time', type: 'timestamp' }, { id: 'inn' }] } }`, ...admin });
    // счета
    const reg = await WORK.get_item('/DATA/REGISTER');
    const acc = async (id, label, extra = '') => reg.create({ id, type: '$account',
        post: `export default { label: '${label}', icon: 'carbon:wallet', ${extra} }`, ...admin });
    await acc('62', 'Расчёты с покупателями', `METADATA: { FIELDS: [
        { id: 'counterparty', type: 'Link', catalog: '/DATA/CATALOGS/КОНТРАГЕНТЫ', analytic: true } ],
        INDEXES: [{ id: 'turnover', kind: 'turnover', by: ['counterparty'], measures: { debit: 'sum', credit: 'sum' } }] }`);
    await acc('90', 'Продажи');
    await acc('51', 'Расчётный счёт');
    await acc('ПИСЬМА', 'Письма');
    // операции
    const ops = await WORK.get_item('/DATA/OPERATIONS');
    const op = async (id, label, fields, postings) => ops.create({ id, type: '$operation',
        post: `export default { label: '${label}', ${SEC}, METADATA: { FIELDS: ${fields}, POSTINGS: ${postings} } }`, ...admin });
    const CF = `{ id: 'client', type: 'Link', catalog: '/DATA/CATALOGS/КОНТРАГЕНТЫ', required: true }`;
    const SF = `{ id: 'sum', type: 'Number', required: true }`;
    await op('ПРОДАЖА', 'Продажа', `[{ id: 'name' }, { id: 'time' }, ${CF}, ${SF}]`,
        `[{ id: 'main', amount: 'sum', debit: { account: '/DATA/REGISTER/62', analytics: { counterparty: 'client' } }, credit: { account: '/DATA/REGISTER/90' } }]`);
    await op('ОПЛАТА', 'Оплата', `[{ id: 'name' }, { id: 'time' }, ${CF}, ${SF}]`,
        `[{ id: 'main', amount: 'sum', debit: { account: '/DATA/REGISTER/51' }, credit: { account: '/DATA/REGISTER/62', analytics: { counterparty: 'client' } } }]`);
    await op('ПИСЬМО', 'Письмо', `[{ id: 'name' }, { id: 'time' }, ${CF}, { id: 'qty', type: 'Number' }, { id: 'sum', type: 'Number' }]`,
        `[{ id: 'main', amount: 'sum', quantity: 'qty', debit: { account: '/DATA/REGISTER/62', analytics: { counterparty: 'client' } }, credit: { account: '/DATA/REGISTER/ПИСЬМА' } }]`);
    // данные продавцом через рабочее место
    const kc = await WORK.get_item('/DATA/CATALOGS/КОНТРАГЕНТЫ');
    globalThis.__a = (await kc.create_object({ filename: 'a.data', post: { name: 'Альфа', inn: '1' }, ...user })).id;
    globalThis.__b = (await kc.create_object({ filename: 'b.data', post: { name: 'Бета', inn: '2' }, ...user })).id;
    const sale = await WORK.get_item('/DATA/OPERATIONS/ПРОДАЖА');
    globalThis.__s1 = (await sale.create_object({ filename: 's1.data', post: { name: 'Продажа Альфе', client: globalThis.__a, sum: 1000 }, ...user })).id;
    globalThis.__s2 = (await sale.create_object({ filename: 's2.data', post: { name: 'Продажа Бете', client: globalThis.__b, sum: 500 }, ...user })).id;
    const pay = await WORK.get_item('/DATA/OPERATIONS/ОПЛАТА');
    globalThis.__p1 = (await pay.create_object({ filename: 'p1.data', post: { name: 'Оплата Альфы', client: globalThis.__a, sum: 700 }, ...user })).id;
    const letter = await WORK.get_item('/DATA/OPERATIONS/ПИСЬМО');
    globalThis.__l1 = (await letter.create_object({ filename: 'l1.data', post: { name: 'Письмо Альфе', client: globalThis.__a, qty: 1, sum: 20 }, ...user })).id;
    for (const [cls, id] of [[sale, globalThis.__s1], [sale, globalThis.__s2], [pay, globalThis.__p1], [letter, globalThis.__l1]])
        await cls.post({ id, ...user });
});

after(async () => {
    await new Promise(r => setTimeout(r, 300));
    closeIndexDb();
    process.chdir(prev);
    try { await fsp.rm(tmp, { recursive: true, force: true }); } catch { /* windows */ }
});

describe('учёт из рабочего места', () => {
    const user = as(USER1);

    it('сальдо 62 по контрагентам: продажи + письма − оплаты', async () => {
        const acc62 = await WORK.get_item('/DATA/REGISTER/62');
        const t = await acc62.index({ id: 'turnover', ...user });
        const byCode = Object.fromEntries(t.rows.map(r => [r.fields.counterparty, r]));
        const sum = (r) => ({ debit: Number(r?.debit) || 0, credit: Number(r?.credit) || 0 });
        assert.deepEqual(sum(byCode[globalThis.__a]), { debit: 1020, credit: 700 });
        assert.deepEqual(sum(byCode[globalThis.__b]), { debit: 500, credit: 0 });
        const t90 = await (await WORK.get_item('/DATA/REGISTER/90')).query({ ...user });
        assert.equal(t90.reduce((s, r) => s + (Number(r.body.credit) || 0), 0), 1500);
        const t51 = await (await WORK.get_item('/DATA/REGISTER/51')).query({ ...user });
        assert.equal(t51.reduce((s, r) => s + (Number(r.body.debit) || 0), 0), 700);
    });

    it('продавец не пишет в счета напрямую', async () => {
        const acc62 = await WORK.get_item('/DATA/REGISTER/62');
        await assert.rejects(acc62.create_object({ filename: 'x.data', post: { debit: 1 }, ...user }), /Доступ запрещён/);
    });

    it('unpost оплаты возвращает сальдо', async () => {
        const pay = await WORK.get_item('/DATA/OPERATIONS/ОПЛАТА');
        await pay.unpost({ id: globalThis.__p1, mode: 'replace', ...user });
        const t51 = await (await WORK.get_item('/DATA/REGISTER/51')).query({ ...user });
        assert.ok(t51.every(r => r.body.deleted));
        const t = await (await WORK.get_item('/DATA/REGISTER/62')).index({ id: 'turnover', ...user });
        const row = t.rows.find(r => r.fields.counterparty === globalThis.__a);
        assert.deepEqual({ debit: Number(row?.debit) || 0, credit: Number(row?.credit) || 0 }, { debit: 1020, credit: 0 });
    });
});
