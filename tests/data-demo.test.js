/**
 * Демо-конфигурация дистрибьютора масел и топлива: настоящее дерево DATA/ORGANIZATIONS/Маслоторг
 * (docs/architecture-v2.md, раздел 4) — классы, схемы, ссылки мест и сквозной сценарий проведения.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDataDb } from '../sources/data/db.js';
import { refreshClasses, classesOfType, getClass, DATA_TYPES, STRUCTURE_TYPES } from '../sources/data/classes.js';
import { checkSchema, classSchema } from '../sources/data/schema.js';
import { createObject } from '../sources/data/objects.js';
import { registerOperation, operationEntries } from '../sources/data/posting.js';
import { trialBalance, virtualMembers, objectState } from '../sources/data/reports.js';
import { LINK_SCOPES } from '../sources/server/access/workplaces.js';
import { printTemplates, renderPrint, parseTemplate, amountInWords } from '../sources/data/print.js';
import { seedDemo, NORMS } from '../scripts/demo-seed.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const Y = new Date().getFullYear();
const d = md => `${Y}-${md}`;

let db, problems, ids;

before(async () => {
    db = await openDataDb(':memory:');
    problems = (await refreshClasses(db, ROOT)).problems;
});

after(() => db?.close());

describe('классы демо-конфигурации', () => {
    it('дерево читается без проблем, у каждого класса идентификатор равен его пути (без искусственных CID и $registry)', () => {
        assert.deepEqual(problems, []);
        const bad = classesOfType(db, [...DATA_TYPES, ...STRUCTURE_TYPES])
            .filter(c => c.cid !== c.path || c.own.CID !== undefined);
        assert.deepEqual(bad.map(c => c.path), []);
        assert.deepEqual(classesOfType(db, '$registry'), []);
        assert.deepEqual(classesOfType(db, '$class'), [], 'абстрактный $class не должен встречаться как экземпляр в дереве');
        assert.equal(getClass(db, '/ORGANIZATIONS')?.type, '$domain');
        assert.equal(getClass(db, '/MODULES')?.type, '$domain');
    });

    it('схемы всех классов корректны, листья операций проводятся полностью', () => {
        for (const c of classesOfType(db, DATA_TYPES))
            assert.deepEqual(checkSchema(db, c.cid), [], c.path);
    });

    it('состав: справочники, структуры, операции и счета из раздела 4', () => {
        const labels = type => classesOfType(db, type).map(c => c.label);
        for (const l of ['Юр. лица', 'Физ. лица', 'Номенклатура', 'Склады и резервуары', 'Партии', 'Договоры', 'Транспорт', 'Виды нормативов', 'Клиенты', 'Поставщики', 'Сотрудники', 'В отпуске'])
            assert.ok(labels(['$catalog', '$virtual']).includes(l), l);
        for (const l of ['Адрес', 'Паспорт', 'Единица измерения'])
            assert.ok(labels('$struct').includes(l), l);
        for (const l of ['Поступление товара', 'Перемещение', 'Фасовка', 'Покупателю', 'Возврат от покупателя', 'Доставка', 'Естественная убыль',
            'Инвентаризация', 'Начисление зарплаты', 'Приём на работу', 'Письмо', 'Звонок', 'Установка норматива', 'От покупателя', 'Поставщику'])
            assert.ok(labels('$operation').includes(l), l);
        assert.deepEqual(classesOfType(db, '$operation').filter(c => classSchema(db, c.cid).fields.some(f => f.id === 'time')), [], 'дата операции — колонка, не поле');
    });

    it('структуры ($struct) и table: true: Паспорт → Адрес у физлиц, табличные Единицы у номенклатуры; наследование правил платежей', () => {
        const P = '/ORGANIZATIONS/Маслоторг/MODULES/Register';
        const items = classSchema(db, `${P}/CATALOGS/Номенклатура`);
        const units = items.fields.find(f => f.id === 'units');
        assert.equal(units.type, 'table');
        assert.equal(units.table, true);
        assert.equal(units.struct, `${P}/STRUCTS/Единица измерения`);
        assert.deepEqual(units.fields.map(f => f.id), ['unit', 'coef', 'price']);

        const person = classSchema(db, `${P}/CATALOGS/Субъекты/Физ. лица`);
        const passport = person.fields.find(f => f.id === 'passport');
        assert.equal(passport.type, 'struct');
        assert.equal(passport.table, false);
        assert.equal(passport.struct, `${P}/STRUCTS/Паспорт`);
        const addr = passport.fields.find(f => f.id === 'address');
        assert.equal(addr.type, 'struct');
        assert.equal(addr.struct, `${P}/STRUCTS/Адрес`);
        assert.deepEqual(addr.fields.map(f => f.id), ['city', 'street', 'house']);

        const pay = classSchema(db, `${P}/OPERATIONS/Платежи с расчётного счёта/Поставщику`);
        const main = pay.postings.find(r => r.id === 'main');
        assert.deepEqual([main.debit.account, main.credit.account, main.amount], [`${P}/REGISTER/60`, `${P}/REGISTER/51`, 'sum']);

        const orgNorms = classSchema(db, `${P}/REGISTER/Нормативы`);
        assert.equal(orgNorms.norms, true);
    });

    it('места: ссылки указывают на существующие классы, места уникальны в подразделении', () => {
        const units = classesOfType(db, '$structure').filter(c => c.own['#security']);
        assert.ok(units.length >= 6);
        for (const u of [...units, getClass(db, '/ORGANIZATIONS/Маслоторг')]) {
            const sec = u.own['#security'];
            const ids = [];
            const walk = (places, trail) => {
                for (const p of places || []) {
                    ids.push([...trail, p.id].join('/'));
                    for (const l of p.LINKS || [])
                        check(l, `${u.path} ${p.id}`);
                    walk(p.ROLES, [...trail, p.id]);
                }
            };
            const check = (l, where) => {
                assert.ok(getClass(db, l.id), `${where}: класс ${l.id} не найден`);
                assert.ok(['read', 'write'].includes(l.access), where);
                assert.ok(!l.scope || LINK_SCOPES.includes(l.scope), `${where}: scope ${l.scope}`);
            };
            for (const l of sec.LINKS || [])
                check(l, u.path);
            walk(sec.ROLES, []);
            assert.equal(new Set(ids).size, ids.length, u.path);
        }
    });
});

describe('сквозной сценарий', () => {
    let sale, payment;
    const post = (cid, md, body, extra = {}) => {
        const o = createObject(db, { cid, time: d(md), body, author: 'U1', ...extra });
        return registerOperation(db, { id: o.id }) && o;
    };
    const entries = o => operationEntries(db, o.id);
    const sum = (list, key = 'amount') => list.reduce((s, e) => s + e[key], 0);

    before(() => {
        ids = seedDemo(db, { since: d('01-01'), author: 'U1' });
    });

    it('нормативы заданы при заполнении', () => {
        assert.equal(Object.keys(NORMS).length, 8);
        assert.ok(ids['kind:Ставка НДС'] && ids.oil && ids.tank);
    });

    it('поступление: НДС отдельной проводкой, масса партии по плотности', () => {
        const o = post('/ORGANIZATIONS/Маслоторг/MODULES/Register/OPERATIONS/Поступление товара', '02-01', {
            supplier: ids.supplier, storage: ids.tank, vat_sum: 30000,
            lines: [{ item: ids.oil, unit: 'бочка', qty: 5, price: 30000, density: 0.88 }],
        }, { unit: '/ORGANIZATIONS/Маслоторг/warehouse', place: 'head' });
        const e = entries(o);
        assert.deepEqual(e.map(x => [x.rule, x.debit, x.credit, x.amount, x.qty]), [
            ['lines', '/ORGANIZATIONS/Маслоторг/MODULES/Register/REGISTER/41', '/ORGANIZATIONS/Маслоторг/MODULES/Register/REGISTER/60', 150000, 1000], ['vat', '/ORGANIZATIONS/Маслоторг/MODULES/Register/REGISTER/19', '/ORGANIZATIONS/Маслоторг/MODULES/Register/REGISTER/60', 30000, 0],
        ]);
        assert.equal(e[0].qty2, 880);
        post('/ORGANIZATIONS/Маслоторг/MODULES/Register/OPERATIONS/Поступление товара', '02-02', {
            supplier: ids.supplier, storage: ids.stock,
            lines: [{ item: ids.canister, unit: 'шт', qty: 100, price: 100 }],
        });
        assert.equal(virtualMembers(db, { cid: '/ORGANIZATIONS/Маслоторг/MODULES/Register/CATALOGS/Поставщики' }).items.length, 1, 'поставщик стал участником сам');
    });

    it('фасовка: масло из резервуара на склад, тара через счёт 20', () => {
        const o = post('/ORGANIZATIONS/Маслоторг/MODULES/Register/OPERATIONS/Фасовка', '02-10', {
            item: ids.oil, from_storage: ids.tank, to_storage: ids.stock,
            lines: [{ unit: 'канистра', qty: 20, container: ids.canister }],
        });
        const e = entries(o);
        assert.deepEqual(e.map(x => [x.rule, x.debit, x.credit, x.amount, x.qty]), [
            ['product', '/ORGANIZATIONS/Маслоторг/MODULES/Register/REGISTER/41', '/ORGANIZATIONS/Маслоторг/MODULES/Register/REGISTER/41', 60000, 400], ['tare_in', '/ORGANIZATIONS/Маслоторг/MODULES/Register/REGISTER/20', '/ORGANIZATIONS/Маслоторг/MODULES/Register/REGISTER/41', 2000, 20], ['tare_out', '/ORGANIZATIONS/Маслоторг/MODULES/Register/REGISTER/41', '/ORGANIZATIONS/Маслоторг/MODULES/Register/REGISTER/20', 2000, 0],
        ]);
        assert.equal(e[0].doc_unit, 'канистра');
    });

    it('реализация: выручка, НДС по нормативу и себестоимость; клиент появляется в составе; себестоимость — скользящая средняя (150 за литр + тара)', () => {
        const o = sale = post('/ORGANIZATIONS/Маслоторг/MODULES/Register/OPERATIONS/Реализация/Покупателю', '03-01', {
            client: ids.client, storage: ids.stock,
            lines: [{ item: ids.oil, unit: 'канистра', qty: 10, price: 3200 }],
        }, { unit: '/ORGANIZATIONS/Маслоторг/sales', place: 'head/manager' });
        const e = entries(o);
        assert.deepEqual(e.map(x => [x.rule, x.debit, x.credit, x.amount]), [
            ['revenue', '/ORGANIZATIONS/Маслоторг/MODULES/Register/REGISTER/62', '/ORGANIZATIONS/Маслоторг/MODULES/Register/REGISTER/90/01', 32000], ['vat', '/ORGANIZATIONS/Маслоторг/MODULES/Register/REGISTER/62', '/ORGANIZATIONS/Маслоторг/MODULES/Register/REGISTER/68/02', 6400], ['cogs', '/ORGANIZATIONS/Маслоторг/MODULES/Register/REGISTER/90/02', '/ORGANIZATIONS/Маслоторг/MODULES/Register/REGISTER/41', 31000],
        ]);
        assert.equal(e[2].qty, 200);
        assert.equal(e[0].unit, '/ORGANIZATIONS/Маслоторг/sales');
        assert.deepEqual(virtualMembers(db, { cid: '/ORGANIZATIONS/Маслоторг/MODULES/Register/CATALOGS/Клиенты' }).items.map(i => i.id), [ids.client]);
    });

    it('оплата гасит долг — клиент выпадает из состава; возврат и платежи', () => {
        post('/ORGANIZATIONS/Маслоторг/MODULES/Register/OPERATIONS/Поступления на расчётный счёт/От покупателя', '03-05', { counterparty: ids.client, sum: 38400 });
        assert.deepEqual(virtualMembers(db, { cid: '/ORGANIZATIONS/Маслоторг/MODULES/Register/CATALOGS/Клиенты' }).items, []);
        const ret = post('/ORGANIZATIONS/Маслоторг/MODULES/Register/OPERATIONS/Реализация/Возврат от покупателя', '03-10', {
            client: ids.client, storage: ids.stock,
            lines: [{ item: ids.oil, unit: 'канистра', qty: 1, price: 3200 }],
        });
        assert.equal(sum(entries(ret)), 3200 + 640 + 3100);
        post('/ORGANIZATIONS/Маслоторг/MODULES/Register/OPERATIONS/Платежи с расчётного счёта/Поставщику', '03-12', { counterparty: ids.supplier, sum: 120000 });
        post('/ORGANIZATIONS/Маслоторг/MODULES/Register/OPERATIONS/Платежи с расчётного счёта/НДС', '03-15', { sum: 5000 });
        payment = post('/ORGANIZATIONS/Маслоторг/MODULES/Register/OPERATIONS/Платежи с расчётного счёта/Поставщику', '03-16', { counterparty: ids.supplier, sum: 1234.5, purpose: 'Оплата по счёту' });
    });

    it('доставка, убыль и инвентаризация считаются по нормативам и расхождениям', () => {
        const dl = post('/ORGANIZATIONS/Маслоторг/MODULES/Register/OPERATIONS/Доставка', '03-20', {
            client: ids.client, vehicle: ids.truck, distance: 100, fuel: ids.diesel, fuel_storage: ids.fuel_stock,
        }, { unit: '/ORGANIZATIONS/Маслоторг/logistics' });
        assert.deepEqual([entries(dl)[0].amount, entries(dl)[0].qty], [1740, 30]);
        const sh = post('/ORGANIZATIONS/Маслоторг/MODULES/Register/OPERATIONS/Естественная убыль', '03-31', { storage: ids.tank, item: ids.oil, base: 1000 });
        assert.deepEqual([entries(sh)[0].amount, entries(sh)[0].qty], [75, 0.5]);
        const inv = post('/ORGANIZATIONS/Маслоторг/MODULES/Register/OPERATIONS/Инвентаризация', '03-31', {
            storage: ids.stock,
            lines: [{ item: ids.oil, unit: 'л', delta: -2 }, { item: ids.oil, unit: 'л', delta: 1 }],
        });
        assert.deepEqual(entries(inv).map(x => [x.rule, x.debit, x.credit, x.amount, x.qty]), [
            ['surplus', '/ORGANIZATIONS/Маслоторг/MODULES/Register/REGISTER/41', '/ORGANIZATIONS/Маслоторг/MODULES/Register/REGISTER/91', 155, 1], ['shortage', '/ORGANIZATIONS/Маслоторг/MODULES/Register/REGISTER/94', '/ORGANIZATIONS/Маслоторг/MODULES/Register/REGISTER/41', 310, 2],
        ]);
    });

    it('кадры: приём, отпуск, зарплата сотрудникам из состава', () => {
        post('/ORGANIZATIONS/Маслоторг/MODULES/Register/OPERATIONS/Кадры/Приём на работу', '04-01', { person: ids.ivanov, position: 'Менеджер', salary: 100000 });
        post('/ORGANIZATIONS/Маслоторг/MODULES/Register/OPERATIONS/Кадры/Приём на работу', '04-01', { person: ids.petrov });
        assert.equal(virtualMembers(db, { cid: '/ORGANIZATIONS/Маслоторг/MODULES/Register/CATALOGS/Сотрудники', at: d('04-02') }).items.length, 2);
        post('/ORGANIZATIONS/Маслоторг/MODULES/Register/OPERATIONS/Кадры/Отправить в отпуск', '07-01', { person: ids.petrov, until: d('07-14') });
        assert.deepEqual(virtualMembers(db, { cid: '/ORGANIZATIONS/Маслоторг/MODULES/Register/CATALOGS/В отпуске', at: d('07-02') }).items.map(i => i.id), [ids.petrov]);
        assert.equal(virtualMembers(db, { cid: '/ORGANIZATIONS/Маслоторг/MODULES/Register/CATALOGS/Сотрудники', at: d('07-02') }).items.length, 2, 'в отпуске — всё ещё сотрудник');
        post('/ORGANIZATIONS/Маслоторг/MODULES/Register/OPERATIONS/Кадры/Вернуть из отпуска', '07-15', { person: ids.petrov });
        assert.deepEqual(virtualMembers(db, { cid: '/ORGANIZATIONS/Маслоторг/MODULES/Register/CATALOGS/В отпуске', at: d('07-16') }).items, []);

        const pr = post('/ORGANIZATIONS/Маслоторг/MODULES/Register/OPERATIONS/Зарплата', '04-30', { period: d('04-01'), staff: [{ employee: ids.ivanov, sum: 100000 }] });
        assert.deepEqual(entries(pr).map(x => [x.rule, x.debit, x.credit, x.amount]), [
            ['accrual', '/ORGANIZATIONS/Маслоторг/MODULES/Register/REGISTER/26', '/ORGANIZATIONS/Маслоторг/MODULES/Register/REGISTER/70', 100000], ['contributions', '/ORGANIZATIONS/Маслоторг/MODULES/Register/REGISTER/26', '/ORGANIZATIONS/Маслоторг/MODULES/Register/REGISTER/69', 30200], ['ndfl', '/ORGANIZATIONS/Маслоторг/MODULES/Register/REGISTER/70', '/ORGANIZATIONS/Маслоторг/MODULES/Register/REGISTER/68/01', 13000],
        ]);
        post('/ORGANIZATIONS/Маслоторг/MODULES/Register/OPERATIONS/Платежи с расчётного счёта/Зарплата', '05-05', { employee: ids.ivanov, sum: 87000 });
    });

    it('коммуникации регистрируются сразу и имеют нормативную стоимость', () => {
        const mail = createObject(db, { cid: '/ORGANIZATIONS/Маслоторг/MODULES/Register/OPERATIONS/Коммуникации/Письмо', time: d('04-05'), body: { counterparty: ids.client, direction: 'Исходящее' } });
        assert.equal(mail.status, 'registered');
        assert.deepEqual([entries(mail)[0].amount, entries(mail)[0].qty], [50, 1]);
        const call = createObject(db, { cid: '/ORGANIZATIONS/Маслоторг/MODULES/Register/OPERATIONS/Коммуникации/Звонок', time: d('04-06'), body: { counterparty: ids.client, direction: 'Входящий', minutes: 3 } });
        assert.deepEqual([entries(call)[0].amount, entries(call)[0].qty], [15, 3]);
    });

    it('печатные формы: наследование шаблонов, накладная и платёжное поручение', async () => {
        const names = async cid => (await printTemplates(db, ROOT, cid)).map(t => t.name);
        assert.deepEqual(await names('/ORGANIZATIONS/Маслоторг/MODULES/Register/OPERATIONS/Реализация/Покупателю'), ['Счёт на оплату', 'Товарная накладная']);
        assert.deepEqual(await names('/ORGANIZATIONS/Маслоторг/MODULES/Register/OPERATIONS/Платежи с расчётного счёта/Поставщику'), ['Платёжное поручение'], 'шаблон группы действует на лист');
        assert.deepEqual(await names('/ORGANIZATIONS/Маслоторг/MODULES/Register/OPERATIONS/Платежи с расчётного счёта/НДС'), ['Платёжное поручение']);
        assert.deepEqual(await names('/ORGANIZATIONS/Маслоторг/MODULES/Register/OPERATIONS/Поступление товара'), []);

        const bill = await renderPrint(db, { id: sale.id, name: 'Товарная накладная', root: ROOT });
        assert.equal(bill.label, 'Товарная накладная');
        for (const part of ['Масло моторное 10W-40', 'ООО «Автосервис Плюс»', '32 000,00', '6 400,00', '38 400,00',
            'Тридцать восемь тысяч четыреста рублей 00 копеек', 'ООО «Маслоторг», ИНН 7700000001'])
            assert.ok(bill.html.replaceAll('\u00a0', ' ').includes(part), part);
        assert.ok(!bill.html.includes('{{'), 'все подстановки раскрыты');

        const pay = await renderPrint(db, { id: payment.id, root: ROOT });
        assert.ok(pay.html.replaceAll('\u00a0', ' ').includes('1 234,50') && pay.html.includes('Одна тысяча двести тридцать четыре рубля 50 копеек'));
        assert.ok(pay.html.includes('ООО «Нефтехим-Поставка»'));
        await assert.rejects(renderPrint(db, { id: sale.id, root: ROOT }), /несколько форм/);
        await assert.rejects(renderPrint(db, { id: ids.oil, root: ROOT }), /только у операций/);
    });

    it('шаблонизатор: экранирование, блоки, ошибки разметки, сумма прописью', () => {
        assert.deepEqual(parseTemplate('a {{x}} {{#if y}}b{{/if}}').map(n => n.t), ['text', 'expr', 'text', 'if']);
        assert.throws(() => parseTemplate('{{#lines}}'), /не закрыт/);
        assert.throws(() => parseTemplate('{{/lines}}'), /без открывающего/);
        assert.throws(() => parseTemplate('{{#lines}}{{/if}}'), /ожидалось/);
        assert.throws(() => parseTemplate('{{ 1 + }}'), /выражение/);
        assert.equal(amountInWords(0), 'Ноль рублей 00 копеек');
        assert.equal(amountInWords(21001.01), 'Двадцать одна тысяча один рубль 01 копейка');
        assert.equal(amountInWords(2000000.5), 'Два миллиона рублей 50 копеек');
        assert.equal(amountInWords(112.12), 'Сто двенадцать рублей 12 копеек');
    });

    it('ОСВ сходится, долг клиента и остаток товара видны в состоянии объектов', () => {
        const r = trialBalance(db, { to: d('12-31') });
        assert.deepEqual(r.total.closing.debit, r.total.closing.credit);
        assert.deepEqual(r.total.turnover.debit, r.total.turnover.credit);
        const bal = objectState(db, { id: ids.oil }).balances;
        const at = account => bal.find(b => b.account === account);
        assert.deepEqual([at('/ORGANIZATIONS/Маслоторг/MODULES/Register/REGISTER/41').qty, at('/ORGANIZATIONS/Маслоторг/MODULES/Register/REGISTER/41').qty2], [818.5, 880], '1000 − 200 + 20 (возврат) − 0,5 (убыль) − 2 + 1 (инвентаризация)');
        assert.equal(at('/ORGANIZATIONS/Маслоторг/MODULES/Register/REGISTER/94').qty, 2.5, 'убыль и недостача');
    });
});
