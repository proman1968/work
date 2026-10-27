/**
 * Учётное ядро v2: проведение операций (sources/data/posting.js).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openDataDb } from '../sources/data/db.js';
import { refreshClasses } from '../sources/data/classes.js';
import { createObject, readObject, updateObject, deleteObject, referencedBy, queryObjects } from '../sources/data/objects.js';
import {
    registerOperation, correctOperation, cancelOperation, operationEntries, previewEntries,
    normValue, unitCoef, closePeriod, closedUntil, isClosed,
} from '../sources/data/posting.js';
import { DataError } from '../sources/data/errors.js';
import { dayStart } from '../sources/data/time.js';

let tmp, db;
// прошлый год: закрытие периода допускает только прошедшие дни
const Y = new Date().getFullYear() - 1;
const d = md => `${Y}-${md}`;

function cls(rel, type, body) {
    const full = path.join(tmp, rel, type, 'class.js');
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, `export default ${body}`, 'utf-8');
}

const sumOf = (list, key = 'amount') => list.reduce((s, e) => s + e[key], 0);

before(async () => {
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-data-posting-'));
    cls('BASE', '$base', `{ label: 'Организация' }`);
    cls('BASE/SALES', '$structure', `{ label: 'Отдел продаж' }`);

    cls('DATA/CATALOGS', '$catalog', `{ label: 'Справочники' }`);
    cls('DATA/CATALOGS/SUBJECTS', '$catalog', `{ label: 'Субъекты', METADATA: { FIELDS: [{ id: 'name', required: true }] } }`);
    cls('DATA/CATALOGS/STAFF', '$catalog', `{ label: 'Сотрудники', METADATA: { FIELDS: [{ id: 'name', required: true }] } }`);
    cls('DATA/CATALOGS/GOODS', '$catalog', `{ label: 'Номенклатура', METADATA: { FIELDS: [
        { id: 'name', required: true }, { id: 'base_unit' },
        { id: 'units', type: 'Table', FIELDS: [{ id: 'unit', required: true }, { id: 'coef', type: 'Number', required: true }] } ] } }`);
    cls('DATA/CATALOGS/NORM_KINDS', '$catalog', `{ label: 'Виды нормативов', METADATA: { FIELDS: [{ id: 'name', required: true }] } }`);

    cls('DATA/REGISTER', '$register', `{ label: 'Журнал' }`);
    cls('DATA/REGISTER/19', '$account', `{ label: 'НДС по приобретённым' }`);
    cls('DATA/REGISTER/41', '$account', `{ label: 'Товары', METADATA: { FIELDS: [
        { id: 'item', type: 'Link', target: '/DATA/CATALOGS/GOODS', analytic: true, required: true } ] } }`);
    cls('DATA/REGISTER/60', '$account', `{ label: 'Расчёты с поставщиками', METADATA: { FIELDS: [
        { id: 'counterparty', type: 'Link', target: '/DATA/CATALOGS/SUBJECTS', analytic: true, required: true } ] } }`);
    cls('DATA/REGISTER/62', '$account', `{ label: 'Расчёты с покупателями', METADATA: { FIELDS: [
        { id: 'counterparty', type: 'Link', target: '/DATA/CATALOGS/SUBJECTS', analytic: true, required: true } ] } }`);
    cls('DATA/REGISTER/90', '$account', `{ label: 'Продажи' }`);
    cls('DATA/REGISTER/26', '$account', `{ label: 'Общехозяйственные расходы' }`);
    cls('DATA/REGISTER/69', '$account', `{ label: 'Страховые взносы' }`);
    cls('DATA/REGISTER/70', '$account', `{ label: 'Расчёты с персоналом', METADATA: { FIELDS: [
        { id: 'employee', type: 'Link', target: '/DATA/CATALOGS/STAFF', analytic: true, required: true } ] } }`);
    cls('DATA/REGISTER/NORMS', '$account', `{ label: 'Нормы', NORMS: true, METADATA: { FIELDS: [
        { id: 'kind', type: 'Link', target: '/DATA/CATALOGS/NORM_KINDS', analytic: true, required: true },
        { id: 'object', type: 'Link', target: '/DATA/CATALOGS', analytic: true } ] } }`);
    cls('DATA/REGISTER/000', '$account', `{ label: 'Технический' }`);

    cls('DATA/OPERATIONS', '$operation', `{ label: 'Операции', METADATA: { FIELDS: [
        { id: 'name' }, { id: 'sum', type: 'Money' } ] } }`);
    cls('DATA/OPERATIONS/SALE', '$operation', `{ label: 'Реализация', METADATA: {
        FIELDS: [{ id: 'client', type: 'Link', target: '/DATA/CATALOGS/SUBJECTS', required: true }],
        POSTINGS: [{ id: 'main', amount: 'sum', debit: { account: '/DATA/REGISTER/62', analytics: { counterparty: 'client' } }, credit: { account: '/DATA/REGISTER/90' } }] } }`);
    cls('DATA/OPERATIONS/RECEIPT', '$operation', `{ label: 'Поступление товара', METADATA: {
        FIELDS: [{ id: 'supplier', type: 'Link', target: '/DATA/CATALOGS/SUBJECTS', required: true }, { id: 'vat_sum', type: 'Money' },
            { id: 'lines', type: 'Table', required: true, FIELDS: [
                { id: 'goods', type: 'Link', target: '/DATA/CATALOGS/GOODS', required: true }, { id: 'unit' },
                { id: 'qty', type: 'Number', required: true }, { id: 'price', type: 'Money' } ] }],
        POSTINGS: [
            { id: 'lines', each: 'lines', amount: 'row.qty * row.price', qty: 'row.qty', unit: 'row.unit', item: 'row.goods',
              qty2: 'row.qty * coef(row.goods, row.unit) * 0.9',
              debit: { account: '/DATA/REGISTER/41', analytics: { item: 'row.goods' } }, credit: { account: '/DATA/REGISTER/60', analytics: { counterparty: 'supplier' } } },
            { id: 'vat', when: 'vat_sum > 0', amount: 'vat_sum',
              debit: { account: '/DATA/REGISTER/19' }, credit: { account: '/DATA/REGISTER/60', analytics: { counterparty: 'supplier' } } } ] } }`);
    cls('DATA/OPERATIONS/PAYROLL', '$operation', `{ label: 'Начисление зарплаты', METADATA: {
        FIELDS: [{ id: 'staff', type: 'Table', required: true, FIELDS: [
            { id: 'employee', type: 'Link', target: '/DATA/CATALOGS/STAFF', required: true }, { id: 'sum', type: 'Money', required: true } ] }],
        POSTINGS: [
            { id: 'accrual', each: 'staff', amount: 'row.sum', debit: { account: '/DATA/REGISTER/26' }, credit: { account: '/DATA/REGISTER/70', analytics: { employee: 'row.employee' } } },
            { id: 'taxes', each: 'staff', amount: "round(row.sum * norm('Ставка взносов', row.employee), 2)", debit: { account: '/DATA/REGISTER/26' }, credit: { account: '/DATA/REGISTER/69' } } ] } }`);
    cls('DATA/OPERATIONS/SET_NORM', '$operation', `{ label: 'Установка норматива', AUTO_REGISTER: true, METADATA: {
        FIELDS: [{ id: 'kind', type: 'Link', target: '/DATA/CATALOGS/NORM_KINDS', required: true }, { id: 'object', type: 'Link', target: '/DATA/CATALOGS' },
            { id: 'value', type: 'Number', required: true }],
        POSTINGS: [{ id: 'norm', qty: 'value - norm(kind, object, 0)',
            debit: { account: '/DATA/REGISTER/NORMS', analytics: { kind: 'kind', object: 'object' } }, credit: { account: '/DATA/REGISTER/000' } }] } }`);
    cls('DATA/OPERATIONS/AUTO_BAD', '$operation', `{ label: 'Письмо без норматива', AUTO_REGISTER: true, METADATA: {
        POSTINGS: [{ id: 'cost', amount: "norm('Нет такого')", debit: { account: '/DATA/REGISTER/26' }, credit: { account: '/DATA/REGISTER/000' } }] } }`);

    db = await openDataDb(':memory:');
    const res = await refreshClasses(db, tmp);
    assert.deepEqual(res.problems, []);
});

after(async () => {
    db?.close();
    try { await fsp.rm(tmp, { recursive: true, force: true }); } catch { /* windows */ }
});

describe('проведение', () => {
    let buyer, supplier, staffA, staffB, oil, rate, sale, payroll, receipt, julyNorm;

    it('справочники для проведения', () => {
        buyer = createObject(db, { cid: '/DATA/CATALOGS/SUBJECTS', body: { name: 'ООО «Покупатель»' } });
        supplier = createObject(db, { cid: '/DATA/CATALOGS/SUBJECTS', body: { name: 'АО «НПЗ»' } });
        staffA = createObject(db, { cid: '/DATA/CATALOGS/STAFF', body: { name: 'Смирнова' } });
        staffB = createObject(db, { cid: '/DATA/CATALOGS/STAFF', body: { name: 'Козлов' } });
        oil = createObject(db, { cid: '/DATA/CATALOGS/GOODS', body: { name: 'Масло И-40А', base_unit: 'л', units: [{ unit: 'бочка', coef: 216.5 }, { unit: 'кг', coef: 1.1 }] } });
        rate = createObject(db, { cid: '/DATA/CATALOGS/NORM_KINDS', body: { name: 'Ставка взносов' } });
    });

    it('AUTO_REGISTER: установка норматива регистрируется при создании и проводит разницу', () => {
        const jan = createObject(db, { cid: '/DATA/OPERATIONS/SET_NORM', time: d('01-01'), body: { kind: rate.id, value: 0.3 }, author: 'U1' });
        assert.equal(jan.status, 'registered');
        assert.equal(operationEntries(db, jan.id)[0].qty, 0.3);
        julyNorm = createObject(db, { cid: '/DATA/OPERATIONS/SET_NORM', time: d('07-01'), body: { kind: rate.id, value: 0.302 } });
        assert.equal(operationEntries(db, julyNorm.id)[0].qty, 0.002);
        createObject(db, { cid: '/DATA/OPERATIONS/SET_NORM', time: d('01-01'), body: { kind: rate.id, object: staffA.id, value: 0.1 } });
    });

    it('norm(): остаток на дату, норматив объекта с откатом к общему, вид по имени и id', () => {
        assert.equal(normValue(db, 'Ставка взносов', null, d('03-01')), 0.3);
        assert.equal(normValue(db, rate.id, null, d('08-01')), 0.302);
        assert.equal(normValue(db, 'Ставка взносов', staffA.id, d('08-01')), 0.1);
        assert.equal(normValue(db, 'Ставка взносов', staffB.id, d('08-01')), 0.302);
        assert.equal(normValue(db, 'Ставка взносов', staffB.id, d('08-01'), { fallback: 0 }), 0, 'с fallback — только точный');
        assert.throws(() => normValue(db, 'Ставка взносов', null, `${Y - 1}-12-31`), /не задан/);
        assert.throws(() => normValue(db, 'Ставка НДФЛ', null, d('08-01')), /не найден/);
    });

    it('черновик не имеет проводок; регистрация: each, норматив, автоаналитики', () => {
        payroll = createObject(db, { cid: '/DATA/OPERATIONS/PAYROLL', time: d('08-10'), author: 'U2', unit: '/BASE/SALES', place: 'buh',
            body: { staff: [{ employee: staffA.id, sum: 50000 }, { employee: staffB.id, sum: 40000 }] } });
        assert.equal(payroll.status, 'draft');
        assert.deepEqual(operationEntries(db, payroll.id), []);
        const reg = registerOperation(db, { id: payroll.id, author: 'U3', version: payroll.version });
        assert.equal(reg.status, 'registered');
        const entries = operationEntries(db, payroll.id);
        assert.deepEqual(entries.map(e => [e.rule, e.row, e.debit, e.credit, e.amount]), [
            ['accrual', 0, '/DATA/REGISTER/26', '/DATA/REGISTER/70', 50000], ['accrual', 1, '/DATA/REGISTER/26', '/DATA/REGISTER/70', 40000],
            ['taxes', 0, '/DATA/REGISTER/26', '/DATA/REGISTER/69', 5000], ['taxes', 1, '/DATA/REGISTER/26', '/DATA/REGISTER/69', 12080],
        ]);
        assert.deepEqual(entries[1].credit_analytics, { employee: staffB.id });
        assert.equal(entries[0].time, dayStart(d('08-10')));
        assert.deepEqual([entries[0].author, entries[0].place, entries[0].unit, entries[0].op_cid], ['U3', 'buh', '/BASE/SALES', '/DATA/OPERATIONS/PAYROLL']);
        assert.equal(registerOperation(db, { id: payroll.id }).version, reg.version, 'повторная регистрация ничего не меняет');
        assert.ok(referencedBy(db, staffA.id).entries > 0);
        assert.throws(() => deleteObject(db, { id: rate.id }), /используется/);
    });

    it('единицы: количество в базовой единице, doc_qty/doc_unit, qty2; нулевая строка и when', () => {
        receipt = createObject(db, { cid: '/DATA/OPERATIONS/RECEIPT', time: d('09-10'), body: { supplier: supplier.id, lines: [
            { goods: oil.id, unit: 'бочка', qty: 2, price: 30000 },
            { goods: oil.id, unit: 'Л', qty: 10, price: 150 },
            { goods: oil.id, qty: 0, price: 1 } ] } });
        registerOperation(db, { id: receipt.id });
        const entries = operationEntries(db, receipt.id);
        assert.deepEqual(entries.map(e => [e.rule, e.row, e.amount, e.qty, e.doc_qty, e.doc_unit]), [
            ['lines', 0, 60000, 433, 2, 'бочка'], ['lines', 1, 1500, 10, 10, 'Л'],
        ]);
        assert.equal(entries[0].qty2, 389.7);
        assert.deepEqual(entries[0].debit_analytics, { item: oil.id });
        assert.equal(unitCoef(db, oil.id, 'КГ'), 1.1);
    });

    it('ошибки проведения — все строки сразу, черновик не меняется', () => {
        const bad = createObject(db, { cid: '/DATA/OPERATIONS/RECEIPT', time: d('09-11'), body: { supplier: supplier.id, lines: [
            { goods: oil.id, unit: 'IBC', qty: 1, price: 1 }, { goods: oil.id, unit: 'канистра', qty: 1, price: 1 } ] } });
        try {
            registerOperation(db, { id: bad.id });
            assert.fail('ожидалась ошибка');
        }
        catch (e) {
            assert.ok(e instanceof DataError);
            assert.deepEqual(e.errors.map(x => x.field), ['правило «lines», строка 1', 'правило «lines», строка 2']);
            assert.match(e.errors[0].message, /нет единицы «IBC»/);
        }
        assert.equal(readObject(db, bad.id).status, 'draft');
        assert.deepEqual(operationEntries(db, bad.id, { history: true }), []);
    });

    it('AUTO_REGISTER с ошибкой правил отменяет и создание', () => {
        const before = queryObjects(db, { cid: '/DATA/OPERATIONS/AUTO_BAD', status: ['draft', 'registered'] }).total;
        assert.throws(() => createObject(db, { cid: '/DATA/OPERATIONS/AUTO_BAD', body: {} }), /«Нет такого» не найден/);
        assert.equal(queryObjects(db, { cid: '/DATA/OPERATIONS/AUTO_BAD', status: ['draft', 'registered'] }).total, before);
    });

    it('исправление: сторно прежних и новые проводки одной версией; when включает правило', () => {
        sale = createObject(db, { cid: '/DATA/OPERATIONS/SALE', body: { client: buyer.id, sum: 1000 } });
        registerOperation(db, { id: sale.id });
        assert.throws(() => updateObject(db, { id: sale.id, body: { sum: 1 } }), /только исправлением/);
        const v = readObject(db, sale.id).version;
        const next = correctOperation(db, { id: sale.id, body: { sum: 1200 }, author: 'U4', version: v });
        assert.equal(next.version, v + 1);
        const history = operationEntries(db, sale.id, { history: true });
        assert.deepEqual(history.map(e => [e.amount, e.storno, e.op_version]), [[1000, false, v], [-1000, true, v + 1], [1200, false, v + 1]]);
        assert.deepEqual(history[1].debit_analytics, { counterparty: buyer.id });
        assert.equal(sumOf(history), 1200);
        assert.deepEqual(operationEntries(db, sale.id).map(e => e.amount), [1200]);
        assert.equal(correctOperation(db, { id: sale.id, body: { sum: 1200 } }).version, v + 1, 'без изменений — без новой версии');
        assert.throws(() => correctOperation(db, { id: sale.id, body: { sum: 1 }, version: v }), /уже изменён/);

        correctOperation(db, { id: receipt.id, body: { vat_sum: 12300 } });
        assert.deepEqual(operationEntries(db, receipt.id).map(e => [e.rule, e.amount]), [['lines', 60000], ['lines', 1500], ['vat', 12300]]);
    });

    it('исправление норматива: разница считается без собственных проводок', () => {
        correctOperation(db, { id: julyNorm.id, body: { value: 0.305 } });
        assert.equal(normValue(db, 'Ставка взносов', null, d('08-01')), 0.305);
        assert.equal(sumOf(operationEntries(db, julyNorm.id, { history: true }), 'qty'), 0.005);
    });

    it('отмена: сторно всех действующих; повтор и исправление отменённой', () => {
        const c = cancelOperation(db, { id: sale.id, author: 'U5' });
        assert.equal(c.status, 'cancelled');
        assert.deepEqual(operationEntries(db, sale.id), []);
        assert.equal(sumOf(operationEntries(db, sale.id, { history: true })), 0);
        assert.equal(cancelOperation(db, { id: sale.id }).version, c.version);
        assert.throws(() => correctOperation(db, { id: sale.id, body: { sum: 5 } }), /исправляется только зарегистрированная/);
        const draft = createObject(db, { cid: '/DATA/OPERATIONS/SALE', body: { client: buyer.id, sum: 1 } });
        assert.throws(() => cancelOperation(db, { id: draft.id }), /черновик удаляют/);
        assert.throws(() => correctOperation(db, { id: draft.id, body: { sum: 2 } }), /черновик/);
        assert.throws(() => registerOperation(db, { id: buyer.id }), /не операция/);
    });

    it('закрытый период: регистрация и перенос запрещены, исправление датируется сегодня', () => {
        assert.throws(() => closePeriod(db, '2999-01-01'), /только прошедший день/);
        assert.equal(closePeriod(db, d('08-31')), d('08-31'));
        assert.equal(closedUntil(db), d('08-31'));
        assert.ok(isClosed(db, dayStart(d('08-31')) + 1000));
        assert.ok(!isClosed(db, dayStart(d('09-01'))));

        const late = createObject(db, { cid: '/DATA/OPERATIONS/SALE', time: d('08-15'), body: { client: buyer.id, sum: 10 } });
        assert.throws(() => registerOperation(db, { id: late.id }), /закрыт — регистрировать/);
        assert.throws(() => correctOperation(db, { id: receipt.id, time: d('08-20'), body: {} }), /закрыт — перенести/);

        const t0 = Date.now();
        correctOperation(db, { id: payroll.id, body: { staff: [{ employee: staffA.id, sum: 60000 }, { employee: staffB.id, sum: 40000 }] } });
        const history = operationEntries(db, payroll.id, { history: true });
        const fresh = history.slice(4);
        assert.equal(fresh.length, 8);
        assert.ok(fresh.every(e => e.time >= t0), 'сторно и новые проводки — сегодняшним днём');
        assert.ok(history.slice(0, 4).every(e => e.time === dayStart(d('08-10'))), 'проводки закрытого периода не тронуты');
        // ставка с июля исправлена на 0.305
        assert.deepEqual(operationEntries(db, payroll.id).map(e => e.amount), [60000, 40000, 6000, 12200]);
        assert.equal(readObject(db, payroll.id).time, dayStart(d('08-10')), 'дата операции не меняется');

        assert.equal(closePeriod(db, null), null);
        assert.equal(registerOperation(db, { id: late.id }).status, 'registered');
    });

    it('предпросмотр проводок без записи', () => {
        const p = previewEntries(db, { cid: '/DATA/OPERATIONS/SALE', body: { client: buyer.id, sum: 77.5 } });
        assert.deepEqual(p.errors, []);
        assert.deepEqual(p.entries.map(e => [e.debit, e.credit, e.amount, e.debit_analytics.counterparty]), [['/DATA/REGISTER/62', '/DATA/REGISTER/90', 77.5, buyer.id]]);
        const bad = previewEntries(db, { cid: '/DATA/OPERATIONS/RECEIPT', body: { supplier: supplier.id, lines: [{ goods: oil.id, unit: 'ведро', qty: 1 }] } });
        assert.match(bad.errors[0].message, /нет единицы «ведро»/);
        assert.throws(() => previewEntries(db, { cid: '/DATA/OPERATIONS/SALE', body: { sum: 1 } }), /обязательное поле/);
    });

    it('пересчёт зависимых списаний (unit_cost) через сторно при исправлении прихода задним числом', async () => {
        cls('DATA/OPERATIONS/WRITE_OFF', '$operation', `{ label: 'Списание товара', METADATA: {
            FIELDS: [{ id: 'goods', type: 'Link', target: '/DATA/CATALOGS/GOODS', required: true }, { id: 'qty', type: 'Number', required: true }],
            POSTINGS: [{ id: 'cost', amount: "round(qty * unit_cost('/DATA/REGISTER/41', goods), 2)", qty: 'qty',
                debit: { account: '/DATA/REGISTER/26' }, credit: { account: '/DATA/REGISTER/41', analytics: { item: 'goods' } } }] } }`);
        await refreshClasses(db, tmp);

        const itemX = createObject(db, { cid: '/DATA/CATALOGS/GOODS', body: { name: 'Смазка X', base_unit: 'кг' } });
        const rec = createObject(db, {
            cid: '/DATA/OPERATIONS/RECEIPT', time: d('10-01'),
            body: { supplier: supplier.id, lines: [{ goods: itemX.id, qty: 10, price: 100 }] },
        });
        registerOperation(db, { id: rec.id });

        const wo = createObject(db, {
            cid: '/DATA/OPERATIONS/WRITE_OFF', time: d('10-05'),
            body: { goods: itemX.id, qty: 4 },
        });
        registerOperation(db, { id: wo.id });
        assert.deepEqual(operationEntries(db, wo.id).map(e => e.amount), [400], '4 кг × 100 руб = 400');

        // Исправляем приход от 10-01: цена 150 вместо 100 → списание от 10-05 должно пересчитаться через сторно (4 × 150 = 600)
        correctOperation(db, {
            id: rec.id,
            body: { supplier: supplier.id, lines: [{ goods: itemX.id, qty: 10, price: 150 }] },
        });
        assert.deepEqual(operationEntries(db, wo.id).map(e => e.amount), [600], 'после правки прихода списание = 600');
        const hist = operationEntries(db, wo.id, { history: true });
        assert.deepEqual(hist.map(e => [e.amount, e.storno]), [[400, false], [-400, true], [600, false]]);
    });
});
