/**
 * Этап 11.3: оборотно-сальдовая ведомость — сальдо на начало, обороты, сальдо на конец,
 * свёртка субсчетов, индекс и скан файлов дают одно и то же, частичный период не берёт чужое.
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
const ADMIN = 'SA000000000001', USER1 = 'SU000000000001', NOBODY = 'SN000000000001';
let tmp, prev;
const as = uid => ({ session: { uid, principal: { kind: 'user', id: uid } } });
const at = s => new Date(s + 'T12:00:00').getTime();

function write(rel, content) {
    const full = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf-8');
}

function copy(rel) {
    write(rel, fs.readFileSync(path.join(ROOT, rel), 'utf-8'));
}

const rule = (debit, credit) => `METADATA: {
    FIELDS: [
        { id: 'name', required: true }, { id: 'time', type: 'timestamp' },
        { id: 'sum', type: 'Number', required: true },
    ],
    POSTINGS: [{ id: 'main', amount: 'sum', debit: { account: '${debit}' }, credit: { account: '${credit}' } }],
}`;
const INDEX = `METADATA: { INDEXES: [{ id: 'turnover', kind: 'turnover', by: [], measures: { debit: 'sum', credit: 'sum' } }] }`;
const acc = (label, extra = '') => `export default { label: '${label}', '#security': { USERS: ['${USER1}'] }${extra ? ', ' + extra : ''} }`;

const row = (res, p) => res.rows.find(r => r.path === p);

before(async () => {
    prev = process.cwd();
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-sheet-'));
    write('$server/class.js', `export default { label: 'WORK', '#security': { ADMINS: ['${ADMIN}'] } }`);
    for (const p of ['$server/$folder', '$server/$folder/$class', '$server/$folder/$file'])
        write(p + '/class.js', 'export default {}');
    write('$server/$folder/$file/$data/class.js', `export default { isDataFile: true, METADATA: { FIELDS: [{ id: 'name' }] } }`);
    for (const [uid, label] of [[ADMIN, 'Админ'], [USER1, 'Бухгалтер'], [NOBODY, 'Чужой']])
        write(`USERS/${uid}/$user/class.js`, `export default { label: '${label}' }`);
    copy('REGISTER/$register/class.js');
    copy('REGISTER/$register/$folder/$class/$account/class.js');
    copy('REGISTER/$register/$folder/$class/$register/class.js');
    copy('OPERATIONS/$operation/class.js');
    copy('OPERATIONS/$operation/$folder/$class/$operation/class.js');
    write('REGISTER/62/$account/class.js', acc('Расчёты'));
    write('REGISTER/62/01/$account/class.js', acc('Покупатели', INDEX));
    write('REGISTER/62/02/$account/class.js', acc('Заказчики'));
    write('REGISTER/90/$account/class.js', acc('Продажи'));
    write('REGISTER/51/$account/class.js', acc('Расчётный счёт'));
    write('REGISTER/99/$account/class.js', acc('Пустой'));
    process.chdir(tmp);
    globalThis.WORK = new $server();
    const ops = await WORK.get_item('/OPERATIONS');
    const admin = as(ADMIN);
    for (const [id, label, d, c] of [
        ['SALE', 'Продажа', '/REGISTER/62/01', '/REGISTER/90'],
        ['SALE2', 'Продажа 2', '/REGISTER/62/02', '/REGISTER/90'],
        ['PAY', 'Оплата', '/REGISTER/51', '/REGISTER/62/01'],
    ])
        await ops.create({ id, type: '$operation', post: `export default { label: '${label}', '#security': { USERS: ['${USER1}'] }, ${rule(d, c)} }`, ...admin });
    const make = async (op, name, sum, day) => {
        const cls = await WORK.get_item('/OPERATIONS/' + op);
        const o = await cls.create_object({ filename: name + '.data', post: { name, sum, time: at(day) }, ...as(USER1) });
        await cls.post({ id: o.id, ...as(USER1) });
    };
    await make('SALE', 'Продажа янв', 1000, '2026-01-10');
    await make('SALE2', 'Продажа 2 фев', 400, '2026-02-05');
    await make('PAY', 'Оплата фев', 600, '2026-02-07');
});

after(async () => {
    await new Promise(r => setTimeout(r, 300));
    closeIndexDb();
    process.chdir(prev);
    try { await fsp.rm(tmp, { recursive: true, force: true }); } catch { /* windows */ }
});

describe('ведомость', () => {
    it('февраль: сальдо на начало, обороты, сальдо на конец, свёртка субсчетов', async () => {
        const reg = await WORK.get_item('/REGISTER');
        const res = await reg.sheet({ from: '2026-02-01', to: '2026-02-28', ...as(USER1) });
        assert.deepEqual(res.rows.map(r => r.path), [
            '/REGISTER/51', '/REGISTER/62', '/REGISTER/62/01', '/REGISTER/62/02', '/REGISTER/90',
        ]);
        const pick = (p) => { const r = row(res, p); return [r.open_debit, r.open_credit, r.debit, r.credit, r.close_debit, r.close_credit]; };
        assert.deepEqual(pick('/REGISTER/51'), [0, 0, 600, 0, 600, 0]);
        assert.deepEqual(pick('/REGISTER/62'), [1000, 0, 400, 600, 800, 0]);
        assert.deepEqual(pick('/REGISTER/62/01'), [1000, 0, 0, 600, 400, 0]);
        assert.deepEqual(pick('/REGISTER/62/02'), [0, 0, 400, 0, 400, 0]);
        assert.deepEqual(pick('/REGISTER/90'), [0, 1000, 0, 400, 0, 1400]);
        assert.equal(row(res, '/REGISTER/62').label, 'Расчёты');
        assert.equal(row(res, '/REGISTER/62/01').level, 1);
        assert.equal(row(res, '/REGISTER/62').leaf, false);
        assert.equal(row(res, '/REGISTER/62/01').leaf, true);
        assert.deepEqual(res.total, { open_debit: 0, open_credit: 0, debit: 1000, credit: 1000, close_debit: 0, close_credit: 0 });
    });

    it('частичный период не берёт чужое: январь без февральских проводок', async () => {
        const reg = await WORK.get_item('/REGISTER');
        const res = await reg.sheet({ to: '2026-01-31', ...as(USER1) });
        const r = row(res, '/REGISTER/62/01');
        assert.equal(r.debit, 1000);
        assert.equal(r.credit, 0, 'оплата февраля не попадает в январь (индекс)');
        assert.equal(row(res, '/REGISTER/90').credit, 1000);
        assert.equal(row(res, '/REGISTER/51'), undefined, 'пустой счёт скрыт');
    });

    it('индекс и скан файлов дают одно и то же', async () => {
        const leaf = await WORK.get_item('/REGISTER/62/01');
        const reg = await WORK.get_item('/REGISTER');
        for (const [from, to] of [[undefined, undefined], ['2026-02-01', '2026-02-28'], [undefined, '2026-01-31'], ['2026-02-06', undefined]]) {
            const viaIndex = await reg._leafSum(leaf, from || '', to || '');
            const scan = await leaf._sumData({ from: from && from + 'T12:00:00', to: to && to + 'T12:00:00' });
            assert.deepEqual(viaIndex, { debit: scan.debit, credit: scan.credit }, `${from}..${to}`);
        }
    });

    it('фильтр счёта и all', async () => {
        const reg = await WORK.get_item('/REGISTER');
        const only = await reg.sheet({ account: '/REGISTER/62', ...as(USER1) });
        assert.deepEqual(only.rows.map(r => r.path), ['/REGISTER/62', '/REGISTER/62/01', '/REGISTER/62/02']);
        const all = await reg.sheet({ all: true, ...as(USER1) });
        assert.ok(row(all, '/REGISTER/99'), 'пустой счёт с all');
        assert.equal(row(await reg.sheet(as(USER1)), '/REGISTER/99'), undefined);
    });

    it('чужому — пусто, через шлюз запрет; плохая дата — ошибка', async () => {
        const reg = await WORK.get_item('/REGISTER');
        const none = await reg.sheet(as(NOBODY));
        assert.deepEqual(none.rows, []);
        await assert.rejects(invoke(reg, 'sheet', as(NOBODY)), /Доступ запрещён/);
        const ok = await invoke(reg, 'sheet', { from: '2026-02-01', ...as(USER1) });
        assert.ok(ok.rows.length > 0);
        await assert.rejects(reg.sheet({ from: 'вчера', ...as(USER1) }), /плохая дата/);
    });
});
