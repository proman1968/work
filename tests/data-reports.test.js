/**
 * Учётное ядро v2: отчёты (sources/data/reports.js).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openDataDb } from '../sources/data/db.js';
import { refreshClasses } from '../sources/data/classes.js';
import { createObject, updateObject } from '../sources/data/objects.js';
import { registerOperation, correctOperation, cancelOperation } from '../sources/data/posting.js';
import {
    journal, trialBalance, accountCard, objectState, objectTrajectory, virtualMembers, isVirtualMember,
} from '../sources/data/reports.js';
import { linkChoices } from '../sources/data/choices.js';
import { dayStart } from '../sources/data/time.js';

let tmp, db;
const Y = new Date().getFullYear() - 1;
const d = md => `${Y}-${md}`;

function cls(rel, type, body) {
    const full = path.join(tmp, rel, type, 'class.js');
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, `export default ${body}`, 'utf-8');
}

const row = (rep, acc, key) => rep.rows.find(r => r.account === acc && (key ? r.key?.counterparty === key : !r.key));

before(async () => {
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-data-reports-'));
    cls('BASE', '$base', `{ CID: 'org', label: 'Организация' }`);
    cls('BASE/SALES', '$structure', `{ CID: 'unit.sales', label: 'Отдел продаж' }`);

    cls('DATA/CATALOGS', '$catalog', `{ CID: 'catalogs', label: 'Справочники' }`);
    cls('DATA/CATALOGS/SUBJECTS', '$catalog', `{ CID: 'subjects', label: 'Субъекты', METADATA: { FIELDS: [{ id: 'name', required: true }] } }`);
    cls('DATA/CATALOGS/GOODS', '$catalog', `{ CID: 'goods', label: 'Номенклатура', METADATA: { FIELDS: [{ id: 'name', required: true }, { id: 'base_unit' }] } }`);
    cls('DATA/CATALOGS/CLIENTS', '$virtual', `{ CID: 'clients', label: 'Клиенты',
        SOURCE: { registry: 'subjects', account: '62' }, OVERLAY: [{ id: 'discount', type: 'Number' }] }`);

    cls('DATA/REGISTER', '$register', `{ CID: 'register', label: 'Журнал' }`);
    cls('DATA/REGISTER/41', '$account', `{ CID: '41', label: 'Товары', METADATA: { FIELDS: [
        { id: 'item', type: 'Link', target: 'goods', analytic: true, required: true } ] } }`);
    cls('DATA/REGISTER/51', '$account', `{ CID: '51', label: 'Расчётные счета' }`);
    cls('DATA/REGISTER/60', '$account', `{ CID: '60', label: 'Расчёты с поставщиками', METADATA: { FIELDS: [
        { id: 'counterparty', type: 'Link', target: 'subjects', analytic: true, required: true } ] } }`);
    cls('DATA/REGISTER/62', '$account', `{ CID: '62', label: 'Расчёты с покупателями', METADATA: { FIELDS: [
        { id: 'counterparty', type: 'Link', target: 'subjects', analytic: true, required: true } ] } }`);
    cls('DATA/REGISTER/62/62.01', '$account', `{ CID: '62.01', label: 'Расчёты в рублях' }`);
    cls('DATA/REGISTER/90', '$account', `{ CID: '90', label: 'Продажи' }`);

    cls('DATA/OPERATIONS', '$operation', `{ CID: 'ops', label: 'Операции', METADATA: { FIELDS: [{ id: 'name' }, { id: 'sum', type: 'Money' }] } }`);
    cls('DATA/OPERATIONS/SALE', '$operation', `{ CID: 'sale', label: 'Реализация', METADATA: {
        FIELDS: [{ id: 'client', type: 'Link', target: 'clients', required: true }],
        POSTINGS: [{ id: 'main', amount: 'sum', debit: { account: '62.01', analytics: { counterparty: 'client' } }, credit: { account: '90' } }] } }`);
    cls('DATA/OPERATIONS/PAYMENT', '$operation', `{ CID: 'payment', label: 'Оплата от покупателя', METADATA: {
        FIELDS: [{ id: 'payer', type: 'Link', target: 'subjects', required: true }],
        POSTINGS: [{ id: 'main', amount: 'sum', debit: { account: '51' }, credit: { account: '62.01', analytics: { counterparty: 'payer' } } }] } }`);
    cls('DATA/OPERATIONS/RECEIPT', '$operation', `{ CID: 'receipt', label: 'Поступление товара', METADATA: {
        FIELDS: [{ id: 'supplier', type: 'Link', target: 'subjects', required: true },
            { id: 'goods', type: 'Link', target: 'goods', required: true }, { id: 'qty', type: 'Number', required: true }],
        POSTINGS: [{ id: 'main', amount: 'sum', qty: 'qty',
            debit: { account: '41', analytics: { item: 'goods' } }, credit: { account: '60', analytics: { counterparty: 'supplier' } } }] } }`);

    db = await openDataDb(':memory:');
    const res = await refreshClasses(db, tmp);
    assert.deepEqual(res.problems, []);
});

after(async () => {
    db?.close();
    try { await fsp.rm(tmp, { recursive: true, force: true }); } catch { /* windows */ }
});

describe('отчёты', () => {
    let a, b, s, oil, saleA2, saleB2;
    const post = (cid, time, body, extra = {}) => {
        const op = createObject(db, { cid, time: d(time), body, ...extra });
        return registerOperation(db, { id: op.id, author: 'U1' });
    };

    it('операции года', () => {
        a = createObject(db, { cid: 'subjects', body: { name: 'ООО «Альфа»' } });
        b = createObject(db, { cid: 'subjects', body: { name: 'ООО «Бета»' } });
        s = createObject(db, { cid: 'subjects', body: { name: 'АО «НПЗ»' } });
        oil = createObject(db, { cid: 'goods', body: { name: 'Масло И-40А', base_unit: 'л' } });
        post('receipt', '01-10', { supplier: s.id, goods: oil.id, qty: 100, sum: 1000 });
        post('sale', '02-01', { client: a.id, sum: 500 });
        post('sale', '02-05', { client: b.id, sum: 300 }, { unit: 'unit.sales' });
        post('payment', '02-10', { payer: a.id, sum: 500 });
        saleA2 = post('sale', '03-01', { client: a.id, sum: 200 });
        correctOperation(db, { id: saleA2.id, body: { sum: 250 } });
        saleB2 = post('sale', '03-05', { client: b.id, sum: 100 }, { unit: 'unit.sales' });
        cancelOperation(db, { id: saleB2.id });
        post('payment', '03-10', { payer: b.id, sum: 400 });
        createObject(db, { cid: 'sale', time: d('03-20'), body: { client: a.id, sum: 999 } }); // черновик — не факт
        updateObject(db, { id: a.id, body: { name: 'ООО «Альфа-Плюс»' }, valid_from: d('03-15') });
    });

    it('журнал: все проводки со сторно, действующие, отборы', () => {
        const all = journal(db);
        assert.equal(all.total, 10);
        assert.equal(all.items[0].time, dayStart(d('01-10')));
        assert.equal(all.names.classes['62.01'], 'Расчёты в рублях');
        assert.equal(all.names.objects[a.id], 'ООО «Альфа-Плюс»');
        const eff = journal(db, { effective: true });
        assert.equal(eff.total, 6);
        assert.equal(eff.sum.amount, 1000 + 500 + 300 + 500 + 250 + 400);
        assert.equal(journal(db, { account: '62' }).total, 9);
        assert.equal(journal(db, { debit: '62' }).total, 7);
        assert.equal(journal(db, { object: a.id }).total, 5);
        assert.equal(journal(db, { op_cid: 'payment' }).total, 2);
        assert.equal(journal(db, { from: d('02-01'), to: d('02-28') }).total, 3);
        const page = journal(db, { limit: 2, offset: 1, desc: true });
        assert.equal(page.items.length, 2);
        assert.equal(page.items[0].time, dayStart(d('03-05')));
        assert.deepEqual(journal(db, { units: [] }).items, []);
    });

    it('ОСВ за период: сальдо, обороты, итог по счёту с субсчетами, итоги сходятся', () => {
        const r = trialBalance(db, { from: d('02-01'), to: d('02-28') });
        assert.deepEqual(r.rows.map(x => [x.account, x.level]), [['41', 0], ['51', 0], ['60', 0], ['62', 0], ['62.01', 1], ['90', 0]]);
        assert.deepEqual(row(r, '41').opening, { debit: 1000, credit: 0 });
        assert.equal(row(r, '41').qty.closing, 100);
        assert.deepEqual(row(r, '62').turnover, { debit: 800, credit: 500 });
        assert.deepEqual(row(r, '62').closing, { debit: 300, credit: 0 });
        assert.deepEqual(row(r, '62.01').closing, row(r, '62').closing);
        assert.deepEqual(r.total.opening, { debit: 1000, credit: 1000 });
        assert.deepEqual(r.total.turnover, { debit: 1300, credit: 1300 });
        assert.deepEqual(r.total.closing, { debit: 1800, credit: 1800 });
    });

    it('ОСВ с разворотом по аналитике: сальдо развёрнутое, сторно уменьшает обороты', () => {
        const flat = trialBalance(db, { to: d('12-31') });
        assert.deepEqual(row(flat, '62').turnover, { debit: 1050, credit: 900 });
        assert.deepEqual(row(flat, '62').closing, { debit: 150, credit: 0 });
        assert.deepEqual(flat.total.closing, { debit: 2050, credit: 2050 });

        const r = trialBalance(db, { to: d('12-31'), by: 'counterparty' });
        assert.deepEqual(row(r, '62.01', a.id).closing, { debit: 250, credit: 0 });
        assert.deepEqual(row(r, '62.01', b.id).closing, { debit: 0, credit: 100 });
        assert.deepEqual(row(r, '62').closing, { debit: 250, credit: 100 });
        assert.deepEqual(row(r, '60', s.id).closing, { debit: 0, credit: 1000 });
        assert.ok(row(r, '41') && !r.rows.some(x => x.account === '41' && x.key), 'счёт без слота не разворачивается');
        assert.deepEqual(r.total.closing, { debit: 2150, credit: 2150 });
        assert.equal(r.names.objects[b.id], 'ООО «Бета»');
        const order = r.rows.filter(x => x.account === '62.01' && x.key).map(x => x.key.counterparty);
        assert.deepEqual(order, [a.id, b.id]);
    });

    it('ОСВ: отбор счёта и подразделения', () => {
        const only = trialBalance(db, { account: '62', to: d('12-31') });
        assert.deepEqual(only.rows.map(x => x.account), ['62', '62.01']);
        const unit = trialBalance(db, { unit: 'org', to: d('12-31') });
        assert.deepEqual(unit.total.turnover, { debit: 300, credit: 300 }, 'проводки с подразделением в поддереве org');
        assert.deepEqual(trialBalance(db, { units: [] }).rows, []);
        assert.throws(() => trialBalance(db, { account: 'sale' }), /счёт sale не найден/);
    });

    it('карточка счёта: сальдо после каждой проводки, корр. счёт, отбор по аналитике', () => {
        const c = accountCard(db, { account: '62', analytics: { counterparty: a.id }, from: d('02-01'), to: d('03-31') });
        assert.deepEqual(c.opening, { debit: 0, credit: 0, qty: 0, qty2: 0 });
        assert.deepEqual(c.items.map(i => [i.side, i.debit, i.credit, i.corr, i.balance, i.storno]), [
            ['debit', 500, 0, '90', 500, false],
            ['credit', 0, 500, '51', 0, false],
            ['debit', 200, 0, '90', 200, false],
            ['debit', -200, 0, '90', 0, true],
            ['debit', 250, 0, '90', 250, false],
        ]);
        assert.deepEqual(c.items[0].analytics, { counterparty: a.id });
        assert.deepEqual([c.turnover.debit, c.turnover.credit], [750, 500]);
        assert.deepEqual(c.closing, { debit: 250, credit: 0, qty: 0, qty2: 0 });

        const tail = accountCard(db, { account: '62', from: d('03-01'), offset: 3, limit: 10 });
        assert.deepEqual(tail.opening, { debit: 300, credit: 0, qty: 0, qty2: 0 });
        assert.equal(tail.total, 6);
        assert.deepEqual(tail.items.map(i => i.balance), [650, 550, 150], 'сальдо страницы учитывает предыдущие строки');
        assert.equal(accountCard(db, { account: '41' }).closing.qty, 100);
        assert.throws(() => accountCard(db, {}), /не задан счёт/);
    });

    it('состояние объекта на момент и траектория', () => {
        const st = objectState(db, { id: a.id, at: d('02-05') });
        assert.deepEqual(st.balances, [{ account: '62.01', slot: 'counterparty', debit: 500, credit: 0, qty: 0, qty2: 0 }]);
        assert.equal(st.object.title, 'ООО «Альфа»', 'версия объекта на момент');
        assert.deepEqual(objectState(db, { id: a.id, at: d('02-10') }).balances, []);
        assert.equal(objectState(db, { id: a.id }).object.title, 'ООО «Альфа-Плюс»');
        assert.deepEqual(objectState(db, { id: oil.id }).balances.map(x => [x.account, x.slot, x.debit, x.qty]), [['41', 'item', 1000, 100]]);

        const tr = objectTrajectory(db, { id: a.id, from: d('02-06') });
        assert.deepEqual(tr.opening.map(x => x.debit), [500]);
        assert.deepEqual(tr.items.map(i => [i.account, i.slot, i.balance]), [
            ['62.01', 'counterparty', 0], ['62.01', 'counterparty', 200], ['62.01', 'counterparty', 0], ['62.01', 'counterparty', 250],
        ]);
        assert.deepEqual(tr.closing.map(x => x.debit), [250]);
        assert.deepEqual(tr.versions.map(v => [v.version, v.body.name]), [[2, 'ООО «Альфа-Плюс»']]);
        assert.equal(tr.names.objects[a.id], 'ООО «Альфа-Плюс»');
        assert.throws(() => objectState(db, { id: 'нет' }), /не найден/);
    });

    it('состав виртуального справочника на дату — по сальдо счёта-источника', () => {
        createObject(db, { cid: 'clients', ext_of: a.id, body: { discount: 5 } });
        const feb7 = virtualMembers(db, { cid: 'clients', at: d('02-07') });
        assert.equal(feb7.slot, 'counterparty');
        assert.deepEqual(feb7.items.map(i => [i.title, i.balance.debit]), [['ООО «Альфа»', 500], ['ООО «Бета»', 300]]);
        assert.equal(feb7.items[0].ext.body.discount, 5);
        assert.equal(feb7.items[1].ext, null);
        assert.deepEqual(virtualMembers(db, { cid: 'clients', at: d('02-10') }).items.map(i => i.id), [b.id]);
        assert.deepEqual(virtualMembers(db, { cid: 'clients', at: d('01-31') }).items, []);
        const now = virtualMembers(db, { cid: 'clients' });
        assert.deepEqual(now.items.map(i => [i.title, i.balance.debit, i.balance.credit]), [['ООО «Альфа-Плюс»', 250, 0], ['ООО «Бета»', 0, 100]]);
        assert.ok(isVirtualMember(db, 'clients', b.id, d('02-10')));
        assert.ok(!isVirtualMember(db, 'clients', a.id, d('02-10')));
        assert.ok(!isVirtualMember(db, 'clients', s.id));
        assert.throws(() => virtualMembers(db, { cid: 'subjects' }), /виртуальный справочник subjects не найден/);
    });

    it('выбор ссылки на виртуальный справочник: состав, поиск с реестром, расширение, создание', () => {
        const ids = r => r.items.map(i => [i.id, i.member]);
        const now = linkChoices(db, { cid: 'sale', field: 'client' });
        assert.equal(now.target, 'clients');
        assert.deepEqual(ids(now), [[a.id, true], [b.id, true]], 'без поиска — только состав');
        assert.equal(now.items[0].ext.body.discount, 5);
        assert.equal(now.others, 1);
        assert.deepEqual(now.create, [{ cid: 'subjects', path: '/DATA/CATALOGS/SUBJECTS', label: 'Субъекты' }]);

        const feb10 = linkChoices(db, { target: 'clients', at: d('02-10') });
        assert.deepEqual(ids(feb10), [[b.id, true]]);
        assert.equal(feb10.others, 2);
        assert.deepEqual(ids(linkChoices(db, { target: 'clients', at: d('02-10'), search: 'ооо' })), [[b.id, true], [a.id, false]],
            'поиск: участники, затем реестр');
        assert.deepEqual(ids(linkChoices(db, { target: 'clients', at: d('02-10'), all: true })), [[b.id, true], [s.id, false], [a.id, false]]);
        assert.deepEqual(ids(linkChoices(db, { target: 'clients', search: 'НПЗ' })), [[s.id, false]]);
        const none = linkChoices(db, { target: 'clients', search: 'Гамма' });
        assert.deepEqual([none.items, none.total], [[], 0]);
        assert.deepEqual(none.create.map(c => c.cid), ['subjects']);

        // не участник на дату — проведение не запрещает: продажа сама делает его клиентом
        const gamma = createObject(db, { cid: none.create[0].cid, body: { name: 'ООО «Гамма»' } });
        const sale = post('sale', '04-01', { client: gamma.id, sum: 10 });
        assert.equal(sale.status, 'registered');
        assert.ok(isVirtualMember(db, 'clients', gamma.id, d('04-01')));

        assert.deepEqual(ids(linkChoices(db, { cid: 'receipt', field: 'goods' })), [[oil.id, true]], 'обычный справочник');
        assert.throws(() => linkChoices(db, { cid: 'sale', field: 'sum' }), /не ссылка/);
    });
});
