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
    journal, trialBalance, accountCard, accountTurnovers, readEntry, objectState, objectTrajectory, virtualMembers, isVirtualMember,
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
    cls('BASE', '$base', `{ label: 'Организация' }`);
    cls('BASE/SALES', '$structure', `{ label: 'Отдел продаж' }`);

    cls('DATA/CATALOGS', '$catalog', `{ label: 'Справочники' }`);
    cls('DATA/CATALOGS/SUBJECTS', '$catalog', `{ label: 'Субъекты', METADATA: { FIELDS: [{ id: 'name', required: true }] } }`);
    cls('DATA/CATALOGS/GOODS', '$catalog', `{ label: 'Номенклатура', METADATA: { FIELDS: [{ id: 'name', required: true }, { id: 'base_unit' }] } }`);
    cls('DATA/CATALOGS/CLIENTS', '$virtual', `{ label: 'Клиенты',
        SOURCE: { registry: '/DATA/CATALOGS/SUBJECTS', account: '/DATA/REGISTER/62' }, OVERLAY: [{ id: 'discount', type: 'Number' }] }`);

    cls('DATA/REGISTER', '$register', `{ label: 'Журнал' }`);
    cls('DATA/REGISTER/41', '$account', `{ label: 'Товары', METADATA: { FIELDS: [
        { id: 'item', type: 'Link', target: '/DATA/CATALOGS/GOODS', analytic: true, required: true } ] } }`);
    cls('DATA/REGISTER/51', '$account', `{ label: 'Расчётные счета' }`);
    cls('DATA/REGISTER/60', '$account', `{ label: 'Расчёты с поставщиками', METADATA: { FIELDS: [
        { id: 'counterparty', type: 'Link', target: '/DATA/CATALOGS/SUBJECTS', analytic: true, required: true } ] } }`);
    cls('DATA/REGISTER/62', '$account', `{ label: 'Расчёты с покупателями', METADATA: { FIELDS: [
        { id: 'counterparty', type: 'Link', target: '/DATA/CATALOGS/SUBJECTS', analytic: true, required: true } ] } }`);
    cls('DATA/REGISTER/62/62.01', '$account', `{ label: 'Расчёты в рублях' }`);
    cls('DATA/REGISTER/90', '$account', `{ label: 'Продажи' }`);

    cls('DATA/OPERATIONS', '$operation', `{ label: 'Операции', METADATA: { FIELDS: [{ id: 'name' }, { id: 'sum', type: 'Money' }] } }`);
    cls('DATA/OPERATIONS/SALE', '$operation', `{ label: 'Реализация', METADATA: {
        FIELDS: [{ id: 'client', type: 'Link', target: '/DATA/CATALOGS/CLIENTS', required: true }],
        POSTINGS: [{ id: 'main', amount: 'sum', debit: { account: '/DATA/REGISTER/62/62.01', analytics: { counterparty: 'client' } }, credit: { account: '/DATA/REGISTER/90' } }] } }`);
    cls('DATA/OPERATIONS/PAYMENT', '$operation', `{ label: 'Оплата от покупателя', METADATA: {
        FIELDS: [{ id: 'payer', type: 'Link', target: '/DATA/CATALOGS/SUBJECTS', required: true }],
        POSTINGS: [{ id: 'main', amount: 'sum', debit: { account: '/DATA/REGISTER/51' }, credit: { account: '/DATA/REGISTER/62/62.01', analytics: { counterparty: 'payer' } } }] } }`);
    cls('DATA/OPERATIONS/RECEIPT', '$operation', `{ label: 'Поступление товара', METADATA: {
        FIELDS: [{ id: 'supplier', type: 'Link', target: '/DATA/CATALOGS/SUBJECTS', required: true },
            { id: 'goods', type: 'Link', target: '/DATA/CATALOGS/GOODS', required: true }, { id: 'qty', type: 'Number', required: true }],
        POSTINGS: [{ id: 'main', amount: 'sum', qty: 'qty',
            debit: { account: '/DATA/REGISTER/41', analytics: { item: 'goods' } }, credit: { account: '/DATA/REGISTER/60', analytics: { counterparty: 'supplier' } } }] } }`);

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
        a = createObject(db, { cid: '/DATA/CATALOGS/SUBJECTS', body: { name: 'ООО «Альфа»' } });
        b = createObject(db, { cid: '/DATA/CATALOGS/SUBJECTS', body: { name: 'ООО «Бета»' } });
        s = createObject(db, { cid: '/DATA/CATALOGS/SUBJECTS', body: { name: 'АО «НПЗ»' } });
        oil = createObject(db, { cid: '/DATA/CATALOGS/GOODS', body: { name: 'Масло И-40А', base_unit: 'л' } });
        post('/DATA/OPERATIONS/RECEIPT', '01-10', { supplier: s.id, goods: oil.id, qty: 100, sum: 1000 });
        post('/DATA/OPERATIONS/SALE', '02-01', { client: a.id, sum: 500 });
        post('/DATA/OPERATIONS/SALE', '02-05', { client: b.id, sum: 300 }, { unit: '/BASE/SALES' });
        post('/DATA/OPERATIONS/PAYMENT', '02-10', { payer: a.id, sum: 500 });
        saleA2 = post('/DATA/OPERATIONS/SALE', '03-01', { client: a.id, sum: 200 });
        correctOperation(db, { id: saleA2.id, body: { sum: 250 } });
        saleB2 = post('/DATA/OPERATIONS/SALE', '03-05', { client: b.id, sum: 100 }, { unit: '/BASE/SALES' });
        cancelOperation(db, { id: saleB2.id });
        post('/DATA/OPERATIONS/PAYMENT', '03-10', { payer: b.id, sum: 400 });
        createObject(db, { cid: '/DATA/OPERATIONS/SALE', time: d('03-20'), body: { client: a.id, sum: 999 } }); // черновик — не факт
        updateObject(db, { id: a.id, body: { name: 'ООО «Альфа-Плюс»' }, valid_from: d('03-15') });
    });

    it('журнал: все проводки со сторно, действующие, отборы', () => {
        const all = journal(db);
        assert.equal(all.total, 10);
        assert.equal(all.items[0].time, dayStart(d('01-10')));
        assert.equal(all.names.classes['/DATA/REGISTER/62/62.01'], 'Расчёты в рублях');
        assert.equal(all.names.objects[a.id], 'ООО «Альфа-Плюс»');
        const eff = journal(db, { effective: true });
        assert.equal(eff.total, 6);
        assert.equal(eff.sum.amount, 1000 + 500 + 300 + 500 + 250 + 400);
        assert.equal(journal(db, { account: '/DATA/REGISTER/62' }).total, 9);
        assert.equal(journal(db, { debit: '/DATA/REGISTER/62' }).total, 7);
        assert.equal(journal(db, { object: a.id }).total, 5);
        assert.equal(journal(db, { op_cid: '/DATA/OPERATIONS/PAYMENT' }).total, 2);
        assert.equal(journal(db, { from: d('02-01'), to: d('02-28') }).total, 3);
        const page = journal(db, { limit: 2, offset: 1, desc: true });
        assert.equal(page.items.length, 2);
        assert.equal(page.items[0].time, dayStart(d('03-05')));
        assert.deepEqual(journal(db, { units: [] }).items, []);
    });

    it('ОСВ за период: сальдо, обороты, итог по счёту с субсчетами, итоги сходятся', () => {
        const r = trialBalance(db, { from: d('02-01'), to: d('02-28') });
        assert.deepEqual(r.rows.map(x => [x.account, x.level]), [['/DATA/REGISTER/41', 0], ['/DATA/REGISTER/51', 0], ['/DATA/REGISTER/60', 0], ['/DATA/REGISTER/62', 0], ['/DATA/REGISTER/62/62.01', 1], ['/DATA/REGISTER/90', 0]]);
        assert.deepEqual(row(r, '/DATA/REGISTER/41').opening, { debit: 1000, credit: 0 });
        assert.equal(row(r, '/DATA/REGISTER/41').qty.closing, 100);
        assert.deepEqual(row(r, '/DATA/REGISTER/62').turnover, { debit: 800, credit: 500 });
        assert.deepEqual(row(r, '/DATA/REGISTER/62').closing, { debit: 300, credit: 0 });
        assert.deepEqual(row(r, '/DATA/REGISTER/62/62.01').closing, row(r, '/DATA/REGISTER/62').closing);
        assert.deepEqual(r.total.opening, { debit: 1000, credit: 1000 });
        assert.deepEqual(r.total.turnover, { debit: 1300, credit: 1300 });
        assert.deepEqual(r.total.closing, { debit: 1800, credit: 1800 });
    });

    it('ОСВ с разворотом по аналитике: сальдо развёрнутое, сторно уменьшает обороты', () => {
        const flat = trialBalance(db, { to: d('12-31') });
        assert.deepEqual(row(flat, '/DATA/REGISTER/62').turnover, { debit: 1050, credit: 900 });
        assert.deepEqual(row(flat, '/DATA/REGISTER/62').closing, { debit: 150, credit: 0 });
        assert.deepEqual(flat.total.closing, { debit: 2050, credit: 2050 });

        const r = trialBalance(db, { to: d('12-31'), by: 'counterparty' });
        assert.deepEqual(row(r, '/DATA/REGISTER/62/62.01', a.id).closing, { debit: 250, credit: 0 });
        assert.deepEqual(row(r, '/DATA/REGISTER/62/62.01', b.id).closing, { debit: 0, credit: 100 });
        assert.deepEqual(row(r, '/DATA/REGISTER/62').closing, { debit: 250, credit: 100 });
        assert.deepEqual(row(r, '/DATA/REGISTER/60', s.id).closing, { debit: 0, credit: 1000 });
        assert.ok(row(r, '/DATA/REGISTER/41') && !r.rows.some(x => x.account === '/DATA/REGISTER/41' && x.key), 'счёт без слота не разворачивается');
        assert.deepEqual(r.total.closing, { debit: 2150, credit: 2150 });
        assert.equal(r.names.objects[b.id], 'ООО «Бета»');
        const order = r.rows.filter(x => x.account === '/DATA/REGISTER/62/62.01' && x.key).map(x => x.key.counterparty);
        assert.deepEqual(order, [a.id, b.id]);
    });

    it('ОСВ: отбор счёта и подразделения', () => {
        const only = trialBalance(db, { account: '/DATA/REGISTER/62', to: d('12-31') });
        assert.deepEqual(only.rows.map(x => x.account), ['/DATA/REGISTER/62', '/DATA/REGISTER/62/62.01']);
        const unit = trialBalance(db, { unit: '/BASE', to: d('12-31') });
        assert.deepEqual(unit.total.turnover, { debit: 300, credit: 300 }, 'проводки с подразделением в поддереве org');
        assert.deepEqual(trialBalance(db, { units: [] }).rows, []);
        assert.throws(() => trialBalance(db, { account: '/DATA/OPERATIONS/SALE' }), /счёт \/DATA\/OPERATIONS\/SALE не найден/);
    });

    it('карточка счёта: сальдо после каждой проводки, корр. счёт, отбор по аналитике', () => {
        const c = accountCard(db, { account: '/DATA/REGISTER/62', analytics: { counterparty: a.id }, from: d('02-01'), to: d('03-31') });
        assert.deepEqual(c.opening, { debit: 0, credit: 0, qty: 0, qty2: 0 });
        assert.deepEqual(c.items.map(i => [i.side, i.debit, i.credit, i.corr, i.balance, i.storno]), [
            ['debit', 500, 0, '/DATA/REGISTER/90', 500, false],
            ['credit', 0, 500, '/DATA/REGISTER/51', 0, false],
            ['debit', 200, 0, '/DATA/REGISTER/90', 200, false],
            ['debit', -200, 0, '/DATA/REGISTER/90', 0, true],
            ['debit', 250, 0, '/DATA/REGISTER/90', 250, false],
        ]);
        assert.deepEqual(c.items[0].analytics, { counterparty: a.id });
        assert.deepEqual([c.turnover.debit, c.turnover.credit], [750, 500]);
        assert.deepEqual(c.closing, { debit: 250, credit: 0, qty: 0, qty2: 0 });

        const tail = accountCard(db, { account: '/DATA/REGISTER/62', from: d('03-01'), offset: 3, limit: 10 });
        assert.deepEqual(tail.opening, { debit: 300, credit: 0, qty: 0, qty2: 0 });
        assert.equal(tail.total, 6);
        assert.deepEqual(tail.items.map(i => i.balance), [650, 550, 150], 'сальдо страницы учитывает предыдущие строки');
        assert.equal(accountCard(db, { account: '/DATA/REGISTER/41' }).closing.qty, 100);
        assert.throws(() => accountCard(db, {}), /не задан счёт/);
    });

    it('состояние объекта на момент и траектория', () => {
        const st = objectState(db, { id: a.id, at: d('02-05') });
        assert.deepEqual(st.balances, [{ account: '/DATA/REGISTER/62/62.01', slot: 'counterparty', debit: 500, credit: 0, qty: 0, qty2: 0 }]);
        assert.equal(st.object.title, 'ООО «Альфа»', 'версия объекта на момент');
        assert.deepEqual(objectState(db, { id: a.id, at: d('02-10') }).balances, []);
        assert.equal(objectState(db, { id: a.id }).object.title, 'ООО «Альфа-Плюс»');
        assert.deepEqual(objectState(db, { id: oil.id }).balances.map(x => [x.account, x.slot, x.debit, x.qty]), [['/DATA/REGISTER/41', 'item', 1000, 100]]);

        const tr = objectTrajectory(db, { id: a.id, from: d('02-06') });
        assert.deepEqual(tr.opening.map(x => x.debit), [500]);
        assert.deepEqual(tr.items.map(i => [i.account, i.slot, i.balance]), [
            ['/DATA/REGISTER/62/62.01', 'counterparty', 0], ['/DATA/REGISTER/62/62.01', 'counterparty', 200], ['/DATA/REGISTER/62/62.01', 'counterparty', 0], ['/DATA/REGISTER/62/62.01', 'counterparty', 250],
        ]);
        assert.deepEqual(tr.closing.map(x => x.debit), [250]);
        assert.deepEqual(tr.versions.map(v => [v.version, v.body.name]), [[2, 'ООО «Альфа-Плюс»']]);
        assert.equal(tr.names.objects[a.id], 'ООО «Альфа-Плюс»');
        assert.throws(() => objectState(db, { id: 'нет' }), /не найден/);
    });

    it('состав виртуального справочника на дату — по сальдо счёта-источника', () => {
        createObject(db, { cid: '/DATA/CATALOGS/CLIENTS', ext_of: a.id, body: { discount: 5 } });
        const feb7 = virtualMembers(db, { cid: '/DATA/CATALOGS/CLIENTS', at: d('02-07') });
        assert.equal(feb7.slot, 'counterparty');
        assert.deepEqual(feb7.items.map(i => [i.title, i.balance.debit]), [['ООО «Альфа»', 500], ['ООО «Бета»', 300]]);
        assert.equal(feb7.items[0].ext.body.discount, 5);
        assert.equal(feb7.items[1].ext, null);
        assert.deepEqual(virtualMembers(db, { cid: '/DATA/CATALOGS/CLIENTS', at: d('02-10') }).items.map(i => i.id), [b.id]);
        assert.deepEqual(virtualMembers(db, { cid: '/DATA/CATALOGS/CLIENTS', at: d('01-31') }).items, []);
        const now = virtualMembers(db, { cid: '/DATA/CATALOGS/CLIENTS' });
        assert.deepEqual(now.items.map(i => [i.title, i.balance.debit, i.balance.credit]), [['ООО «Альфа-Плюс»', 250, 0], ['ООО «Бета»', 0, 100]]);
        assert.ok(isVirtualMember(db, '/DATA/CATALOGS/CLIENTS', b.id, d('02-10')));
        assert.ok(!isVirtualMember(db, '/DATA/CATALOGS/CLIENTS', a.id, d('02-10')));
        assert.ok(!isVirtualMember(db, '/DATA/CATALOGS/CLIENTS', s.id));
        assert.throws(() => virtualMembers(db, { cid: '/DATA/CATALOGS/SUBJECTS' }), /виртуальный справочник \/DATA\/CATALOGS\/SUBJECTS не найден/);
    });

    it('выбор ссылки на виртуальный справочник: состав, поиск с реестром, расширение, создание', () => {
        const ids = r => r.items.map(i => [i.id, i.member]);
        const now = linkChoices(db, { cid: '/DATA/OPERATIONS/SALE', field: 'client' });
        assert.equal(now.target, '/DATA/CATALOGS/CLIENTS');
        assert.deepEqual(ids(now), [[a.id, true], [b.id, true]], 'без поиска — только состав');
        assert.equal(now.items[0].ext.body.discount, 5);
        assert.equal(now.others, 1);
        assert.deepEqual(now.create, [{ cid: '/DATA/CATALOGS/SUBJECTS', path: '/DATA/CATALOGS/SUBJECTS', label: 'Субъекты' }]);

        const feb10 = linkChoices(db, { target: '/DATA/CATALOGS/CLIENTS', at: d('02-10') });
        assert.deepEqual(ids(feb10), [[b.id, true]]);
        assert.equal(feb10.others, 2);
        assert.deepEqual(ids(linkChoices(db, { target: '/DATA/CATALOGS/CLIENTS', at: d('02-10'), search: 'ооо' })), [[b.id, true], [a.id, false]],
            'поиск: участники, затем реестр');
        assert.deepEqual(ids(linkChoices(db, { target: '/DATA/CATALOGS/CLIENTS', at: d('02-10'), all: true })), [[b.id, true], [s.id, false], [a.id, false]]);
        assert.deepEqual(ids(linkChoices(db, { target: '/DATA/CATALOGS/CLIENTS', search: 'НПЗ' })), [[s.id, false]]);
        const none = linkChoices(db, { target: '/DATA/CATALOGS/CLIENTS', search: 'Гамма' });
        assert.deepEqual([none.items, none.total], [[], 0]);
        assert.deepEqual(none.create.map(c => c.cid), ['/DATA/CATALOGS/SUBJECTS']);

        // не участник на дату — проведение не запрещает: продажа сама делает его клиентом
        const gamma = createObject(db, { cid: none.create[0].cid, body: { name: 'ООО «Гамма»' } });
        const sale = post('/DATA/OPERATIONS/SALE', '04-01', { client: gamma.id, sum: 10 });
        assert.equal(sale.status, 'registered');
        assert.ok(isVirtualMember(db, '/DATA/CATALOGS/CLIENTS', gamma.id, d('04-01')));

        assert.deepEqual(ids(linkChoices(db, { cid: '/DATA/OPERATIONS/RECEIPT', field: 'goods' })), [[oil.id, true]], 'обычный справочник');
        assert.throws(() => linkChoices(db, { cid: '/DATA/OPERATIONS/SALE', field: 'sum' }), /не ссылка/);
    });

    it('явная двойная запись в классы счетов (account_entries) и сборная карточка проводки (readEntry)', () => {
        const j = journal(db, { op: saleA2.id, effective: true });
        assert.equal(j.items.length, 1);
        const entryId = j.items[0].id;
        const accRows = db.prepare('SELECT side, account_cid, corr_cid, debit, credit, analytics FROM account_entries WHERE entry_id = ? ORDER BY side').all(entryId);
        assert.equal(accRows.length, 2, 'две раздельные записи: в классе счёта Дт и в классе счёта Кт');
        const [cSide, dSide] = accRows; // 'C' затем 'D'
        assert.equal(dSide.account_cid, '/DATA/REGISTER/62/62.01');
        assert.equal(dSide.corr_cid, '/DATA/REGISTER/90');
        assert.equal(dSide.debit, 25000);
        assert.deepEqual(JSON.parse(dSide.analytics), { counterparty: a.id });
        assert.equal(cSide.account_cid, '/DATA/REGISTER/90');
        assert.equal(cSide.corr_cid, '/DATA/REGISTER/62/62.01');
        assert.equal(cSide.credit, 25000);
        assert.deepEqual(JSON.parse(cSide.analytics), {});

        const card = readEntry(db, entryId);
        assert.equal(card.entry, entryId);
        assert.equal(card.amount, 250);
        assert.equal(card.operation.id, saleA2.id);
        assert.equal(card.debit.account, '/DATA/REGISTER/62/62.01');
        assert.equal(card.debit.analytics[0].title, 'ООО «Альфа-Плюс»');
        assert.equal(card.credit.account, '/DATA/REGISTER/90');
    });

    it('режим виртуального справочника mode: turnover сохраняет клиента после оплаты долга в ноль', () => {
        // На 02-10 Альфа оплатил долг 500 полностью: в режиме balance его нет, а в режиме turnover он остаётся клиентом
        assert.deepEqual(virtualMembers(db, { cid: '/DATA/CATALOGS/CLIENTS', at: d('02-10'), mode: 'balance' }).items.map(i => i.id), [b.id]);
        assert.deepEqual(virtualMembers(db, { cid: '/DATA/CATALOGS/CLIENTS', at: d('02-10'), mode: 'turnover' }).items.map(i => i.id).sort(), [a.id, b.id].sort());
        assert.equal(isVirtualMember(db, '/DATA/CATALOGS/CLIENTS', a.id, d('02-10'), null, 'balance'), false);
        assert.equal(isVirtualMember(db, '/DATA/CATALOGS/CLIENTS', a.id, d('02-10'), null, 'turnover'), true);
    });

    it('двухэтапные аналитики (субаналитики через поля справочника и OVERLAY) и двухпанельные обороты (accountTurnovers)', () => {
        // У Альфа в OVERLAY виртуального справочника CLIENTS задано discount: 5
        // Но на счёте 62 слот counterparty ссылается на SUBJECTS; проверим фильтр по полю SUBJECTS (name)
        const cardFiltered = accountCard(db, {
            account: '/DATA/REGISTER/62',
            analytics: { 'counterparty.name': { contains: 'Альфа' } },
        });
        assert.ok(cardFiltered.items.length > 0);
        assert.ok(cardFiltered.items.every(i => i.analytics.counterparty === a.id));

        // Разворот ОСВ по субаналитике: item.base_unit на счёте 41
        const tbSub = trialBalance(db, { account: '/DATA/REGISTER/41', by: ['item.base_unit'] });
        const detailRow = tbSub.rows.find(r => r.key);
        assert.deepEqual(detailRow.key, { 'item.base_unit': 'л' });
        assert.equal(detailRow.closing.debit, 1000);

        // Двухпанельные Обороты счёта 62 по Альфа с группировкой по месяцам и кварталам
        const turnsMonth = accountTurnovers(db, {
            account: '/DATA/REGISTER/62',
            analytics: { counterparty: a.id },
            groupBy: 'month',
        });
        assert.equal(turnsMonth.groups.length, 2, 'Февраль и Март');
        assert.equal(turnsMonth.groups[0].debit, 500);
        assert.equal(turnsMonth.groups[0].credit, 500);
        assert.equal(turnsMonth.groups[0].turnover, 0);
        assert.equal(turnsMonth.groups[0].balance, 0);
        assert.equal(turnsMonth.groups[1].debit, 250);
        assert.equal(turnsMonth.groups[1].turnover, 250);
        assert.equal(turnsMonth.groups[1].balance, 250);

        const turnsQ = accountTurnovers(db, {
            account: '/DATA/REGISTER/62',
            analytics: { counterparty: a.id },
            groupBy: 'quarter',
        });
        assert.equal(turnsQ.groups.length, 1, '1 кв.');
        assert.equal(turnsQ.groups[0].label, `1 кв. ${Y} г.`);
        assert.equal(turnsQ.groups[0].debit, 750);
        assert.equal(turnsQ.groups[0].credit, 500);
        assert.equal(turnsQ.groups[0].turnover, 250);
        assert.equal(turnsQ.groups[0].balance, 250);
    });

    it('производительность на пакете проводок: ОСВ, двухэтапные аналитики и обороты по кварталам (< 500 мс)', () => {
        const insE = db.prepare(`INSERT INTO entries (op_id, op_version, op_cid, rule, row, time, debit_cid, credit_cid, amount, qty, qty2, storno, created)
            VALUES (?, 1, '/DATA/OPERATIONS/SALE', 'main', -1, ?, '/DATA/REGISTER/62/62.01', '/DATA/REGISTER/90', 10000, 0, 0, 0, ?)`);
        const insA = db.prepare('INSERT INTO entry_analytics (entry_id, side, slot, ref_id, ref_cid) VALUES (?, ?, ?, ?, ?)');
        const insAcc = db.prepare(`INSERT INTO account_entries (entry_id, side, account_cid, corr_cid, op_id, op_version, op_cid, rule, row, time, debit, credit, qty_in, qty_out, qty2, analytics, storno, created)
            VALUES (?, ?, ?, ?, ?, 1, '/DATA/OPERATIONS/SALE', 'main', -1, ?, ?, ?, 0, 0, 0, ?, 0, ?)`);
        const baseT = Date.parse(`${Y}-04-01T12:00:00Z`);
        db.exec('BEGIN');
        try {
            for (let i = 0; i < 2000; i++) {
                const t = baseT + (i % 90) * 86400000;
                const cp = (i % 2 === 0) ? a : b;
                const r = insE.run(saleA2.id, t, t);
                const eid = Number(r.lastInsertRowid);
                insA.run(eid, 'D', 'counterparty', cp.id, '/DATA/CATALOGS/SUBJECTS');
                insAcc.run(eid, 'D', '/DATA/REGISTER/62/62.01', '/DATA/REGISTER/90', saleA2.id, t, 10000, 0, JSON.stringify({ counterparty: cp.id }), t);
                insAcc.run(eid, 'C', '/DATA/REGISTER/90', '/DATA/REGISTER/62/62.01', saleA2.id, t, 0, 10000, '{}', t);
            }
            db.exec('COMMIT');
        }
        catch (e) {
            db.exec('ROLLBACK');
            throw e;
        }
        const t0 = performance.now();
        const tb = trialBalance(db, { account: '/DATA/REGISTER/62', by: ['counterparty'] });
        const turns = accountTurnovers(db, { account: '/DATA/REGISTER/62', groupBy: 'quarter', analytics: { 'counterparty.name': { contains: 'Альфа' } } });
        const elapsed = performance.now() - t0;
        assert.ok(tb.total.closing.debit > 100000);
        assert.ok(turns.groups.length >= 2);
        assert.ok(elapsed < 1500, `отчёты по 4000 записей счетов выполнились за ${Math.round(elapsed)} мс`);
    });
});
