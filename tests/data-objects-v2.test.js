/**
 * Учётное ядро v2: схема по наследованию (sources/data/schema.js) и объекты (objects.js).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openDataDb } from '../sources/data/db.js';
import { refreshClasses } from '../sources/data/classes.js';
import { classSchema, checkSchema } from '../sources/data/schema.js';
import {
    createObject, updateObject, deleteObject, restoreObject, readObject, objectVersions, referencedBy, queryObjects, writeVersion,
} from '../sources/data/objects.js';
import { DataError } from '../sources/data/errors.js';

let tmp, db;

function cls(rel, type, body) {
    const full = path.join(tmp, rel, type, 'class.js');
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, `export default ${body}`, 'utf-8');
}

before(async () => {
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-data-objects-'));
    cls('BASE', '$base', `{ label: 'Организация' }`);
    cls('BASE/SALES', '$structure', `{ label: 'Отдел продаж' }`);
    cls('BASE/STOCK', '$structure', `{ label: 'Склад' }`);

    cls('DATA/STRUCTS/ADDRESS', '$struct', `{ label: 'Адрес', METADATA: { FIELDS: [
        { id: 'city', label: 'Город' }, { id: 'street', label: 'Улица' } ] } }`);
    cls('DATA/STRUCTS/PASSPORT', '$struct', `{ label: 'Паспорт', METADATA: { FIELDS: [
        { id: 'series', label: 'Серия' }, { id: 'number', label: 'Номер' },
        { id: 'address', label: 'Адрес', type: '/DATA/STRUCTS/ADDRESS' } ] } }`);
    cls('DATA/STRUCTS/UNIT', '$struct', `{ label: 'Единица измерения', METADATA: { FIELDS: [
        { id: 'unit', required: true }, { id: 'coef', type: 'Number', required: true } ] } }`);

    cls('DATA/CATALOGS', '$catalog', `{ label: 'Справочники' }`);
    cls('DATA/CATALOGS/SUBJECTS', '$catalog', `{ label: 'Субъекты', METADATA: { FIELDS: [
        { id: 'name', label: 'Наименование', required: true }, { id: 'inn', label: 'ИНН' }, { id: 'reg_date', type: 'date' } ] } }`);
    cls('DATA/CATALOGS/SUBJECTS/LEGAL', '$catalog', `{ label: 'Юридические лица', METADATA: { FIELDS: [{ id: 'kpp', label: 'КПП' }] } }`);
    cls('DATA/CATALOGS/SUBJECTS/PERSONS', '$catalog', `{ label: 'Физические лица', METADATA: { FIELDS: [
        { id: 'inn', label: 'ИНН физлица' }, { id: 'passport', label: 'Паспорт', type: '/DATA/STRUCTS/PASSPORT' } ] } }`);
    cls('DATA/CATALOGS/STAFF', '$catalog', `{ label: 'Сотрудники', METADATA: { FIELDS: [{ id: 'name', required: true }] } }`);
    cls('DATA/CATALOGS/CLIENTS', '$virtual', `{ label: 'Клиенты',
        SOURCE: { registry: '/DATA/CATALOGS/SUBJECTS', account: '/DATA/REGISTER/62', slot: 'counterparty' },
        OVERLAY: [{ id: 'manager', type: 'Link', target: '/DATA/CATALOGS/STAFF', label: 'Менеджер' }, { id: 'discount', type: 'Number' }] }`);
    cls('DATA/CATALOGS/GOODS', '$catalog', `{ label: 'Номенклатура', METADATA: { FIELDS: [
        { id: 'name', required: true }, { id: 'base_unit', type: 'enum', values: ['л', 'кг', 'шт'] },
        { id: 'units', type: '/DATA/STRUCTS/UNIT', table: true } ] } }`);

    cls('DATA/REGISTER', '$register', `{ label: 'Журнал' }`);
    cls('DATA/REGISTER/62', '$account', `{ label: 'Расчёты с покупателями', METADATA: { FIELDS: [
        { id: 'counterparty', type: 'Link', catalog: '/DATA/CATALOGS/SUBJECTS', analytic: true } ] } }`);
    cls('DATA/REGISTER/62/62.01', '$account', `{ label: 'Расчёты в рублях' }`);
    cls('DATA/REGISTER/90', '$account', `{ label: 'Продажи' }`);
    cls('DATA/REGISTER/26', '$account', `{ label: 'Общехозяйственные расходы' }`);
    cls('DATA/REGISTER/69', '$account', `{ label: 'Страховые взносы' }`);
    cls('DATA/REGISTER/70', '$account', `{ label: 'Расчёты с персоналом', METADATA: { FIELDS: [
        { id: 'employee', type: 'Link', target: '/DATA/CATALOGS/STAFF', analytic: true } ] } }`);

    cls('DATA/OPERATIONS', '$operation', `{ label: 'Операции', METADATA: { FIELDS: [
        { id: 'name', label: 'Наименование' }, { id: 'sum', type: 'Money', label: 'Сумма' }, { id: 'note', to_inherit: false } ] } }`);
    cls('DATA/OPERATIONS/SALES', '$operation', `{ label: 'Реализация', METADATA: {
        FIELDS: [{ id: 'client', type: 'Link', catalog: '/DATA/CATALOGS/CLIENTS', required: true }],
        POSTINGS: [{ id: 'main', amount: 'sum', debit: { account: '/DATA/REGISTER/62/62.01', analytics: { counterparty: 'client' } }, credit: { account: '/DATA/REGISTER/90' } }] } }`);
    cls('DATA/OPERATIONS/SALES/RETAIL', '$operation', `{ label: 'Розница' }`);
    cls('DATA/OPERATIONS/SALES/WHOLESALE', '$operation', `{ label: 'Опт', AUTO_REGISTER: true, METADATA: {
        FIELDS: [{ id: 'name', removed: true }, { id: 'contract', label: 'Договор' }],
        POSTINGS: [{ id: 'main', amount: 'round(sum * 1, 2)', quantity: 1 }] } }`);
    cls('DATA/OPERATIONS/PAYROLL', '$operation', `{ label: 'Начисление зарплаты', METADATA: {
        FIELDS: [{ id: 'staff', type: 'Table', label: 'Ведомость', required: true, FIELDS: [
            { id: 'employee', type: 'Link', target: '/DATA/CATALOGS/STAFF', required: true }, { id: 'sum', type: 'Money', required: true } ] }],
        POSTINGS: [
            { id: 'accrual', each: 'staff', amount: 'row.sum', debit: { account: '/DATA/REGISTER/26' }, credit: { account: '/DATA/REGISTER/70', analytics: { employee: 'row.employee' } } },
            { id: 'taxes', each: 'staff', amount: "round(row.sum * norm('Ставка взносов'), 2)", debit: { account: '/DATA/REGISTER/26' }, credit: { account: '/DATA/REGISTER/69' } } ] } }`);
    cls('DATA/OPERATIONS/BROKEN', '$operation', `{ label: 'Сломанная', METADATA: {
        POSTINGS: [
            { id: 'a', amount: 'foo + 1', debit: { account: '/DATA/REGISTER/62' }, credit: { account: '999' } },
            { id: 'b', amount: 'sum', debit: { account: '/DATA/REGISTER/62/62.01', analytics: { other: 'sum' } }, credit: { account: '/DATA/REGISTER/90' } },
            { id: 'c', debit: { account: '/DATA/REGISTER/90' }, credit: { account: '/DATA/REGISTER/26' } },
            { id: 'd', amount: 'evil(sum)', each: 'sum', debit: { account: '/DATA/REGISTER/90' } } ] } }`);

    db = await openDataDb(':memory:');
    const res = await refreshClasses(db, tmp);
    assert.deepEqual(res.problems, []);
});

after(async () => {
    db?.close();
    try { await fsp.rm(tmp, { recursive: true, force: true }); } catch { /* windows */ }
});

describe('схема по наследованию', () => {
    it('поля сливаются от корня к листу; to_inherit:false — только в своём классе', () => {
        assert.deepEqual(classSchema(db, '/DATA/OPERATIONS/SALES/RETAIL').fields.map(f => f.id), ['name', 'sum', 'client']);
        assert.deepEqual(classSchema(db, '/DATA/OPERATIONS').fields.map(f => f.id), ['name', 'sum', 'note']);
    });

    it('потомок уточняет поле, removed убирает, новые поля — в конец', () => {
        assert.equal(classSchema(db, '/DATA/CATALOGS/SUBJECTS/PERSONS').fields.find(f => f.id === 'inn').label, 'ИНН физлица');
        assert.equal(classSchema(db, '/DATA/CATALOGS/SUBJECTS/LEGAL').fields.find(f => f.id === 'inn').label, 'ИНН');
        assert.deepEqual(classSchema(db, '/DATA/OPERATIONS/SALES/WHOLESALE').fields.map(f => f.id), ['sum', 'client', 'contract']);
    });

    it('типы нормализуются: Money, timestamp, Link+catalog → link+target, Table с полями', () => {
        const sale = classSchema(db, '/DATA/OPERATIONS/SALES/RETAIL');
        assert.equal(sale.fields.find(f => f.id === 'sum').type, 'money');
        const client = sale.fields.find(f => f.id === 'client');
        assert.equal(client.type, 'link');
        assert.equal(client.target, '/DATA/CATALOGS/CLIENTS');
        const units = classSchema(db, '/DATA/CATALOGS/GOODS').fields.find(f => f.id === 'units');
        assert.equal(units.type, 'table');
        assert.deepEqual(units.fields.map(f => [f.id, f.type]), [['unit', 'string'], ['coef', 'number']]);
    });

    it('правила проводок сливаются по id: лист уточняет сумму, счета наследует; quantity → qty', () => {
        const main = classSchema(db, '/DATA/OPERATIONS/SALES/WHOLESALE').postings.find(r => r.id === 'main');
        assert.equal(main.amount, 'round(sum * 1, 2)');
        assert.equal(main.qty, 1);
        assert.equal(main.debit.account, '/DATA/REGISTER/62/62.01');
        assert.deepEqual(main.debit.analytics, { counterparty: 'client' });
        assert.equal(classSchema(db, '/DATA/OPERATIONS/SALES/WHOLESALE').autoRegister, true);
        assert.equal(classSchema(db, '/DATA/OPERATIONS/SALES/RETAIL').autoRegister, false);
    });

    it('схема семейства не смешивается с предками другого типа', () => {
        assert.deepEqual(classSchema(db, '/DATA/REGISTER/62/62.01').fields.map(f => f.id), ['counterparty']);
        assert.equal(classSchema(db, '/DATA/REGISTER/62/62.01').family, 'account');
        assert.equal(classSchema(db, '/DATA/CATALOGS/CLIENTS').source.registry, '/DATA/CATALOGS/SUBJECTS');
        assert.deepEqual(classSchema(db, '/DATA/CATALOGS/CLIENTS').overlay.map(f => f.id), ['manager', 'discount']);
    });

    it('корректные листья проходят проверку', () => {
        for (const cid of ['/DATA/OPERATIONS/SALES/RETAIL', '/DATA/OPERATIONS/SALES/WHOLESALE', '/DATA/OPERATIONS/PAYROLL', '/DATA/CATALOGS/SUBJECTS/LEGAL', '/DATA/CATALOGS/GOODS', '/DATA/CATALOGS/CLIENTS', '/DATA/REGISTER/62/62.01'])
            assert.deepEqual(checkSchema(db, cid), [], cid);
    });

    it('ошибки правил листа: не лист, нет счёта, неизвестное поле и функция, аналитики, each', () => {
        const errors = checkSchema(db, '/DATA/OPERATIONS/BROKEN').join('\n');
        assert.match(errors, /«a».*62 \(дебет\) — не лист/);
        assert.match(errors, /«a».*счёт 999 \(кредит\) не найден/);
        assert.match(errors, /«a».*неизвестное поле «foo»/);
        assert.match(errors, /«a».*аналитика «counterparty».*не сопоставлена/);
        assert.match(errors, /«b».*нет аналитики «other»/);
        assert.match(errors, /«c».*нет ни суммы/);
        assert.match(errors, /«d».*each — «sum» не табличная часть/);
        assert.match(errors, /«d».*неизвестная функция evil\(\)/);
        assert.match(errors, /«d».*не задан счёт \(кредит\)/);
    });

    it('кэш схем сбрасывается при изменении class.js', async () => {
        assert.equal(classSchema(db, '/DATA/CATALOGS/STAFF').label, 'Сотрудники');
        const file = path.join(tmp, 'DATA/CATALOGS/STAFF/$catalog/class.js');
        fs.writeFileSync(file, `export default { label: 'Персонал', METADATA: { FIELDS: [{ id: 'name', required: true }] } }`, 'utf-8');
        const later = new Date(Date.now() + 5000);
        fs.utimesSync(file, later, later);
        await refreshClasses(db, tmp);
        assert.equal(classSchema(db, '/DATA/CATALOGS/STAFF').label, 'Персонал');
    });
});

describe('объекты', () => {
    let oil, ivan, petr, staffA, staffB;

    it('создаются только в листе своего семейства', () => {
        assert.throws(() => createObject(db, { cid: '/DATA/CATALOGS/SUBJECTS', body: { name: 'X' } }), /только в конечном классе/);
        assert.throws(() => createObject(db, { cid: '/DATA/REGISTER/62/62.01', body: {} }), /объекты не создаются/);
        assert.throws(() => createObject(db, { cid: 'нет', body: {} }), /не найден/);
    });

    it('проверка тела: обязательные, лишние поля, типы — все ошибки сразу', () => {
        try {
            createObject(db, { cid: '/DATA/CATALOGS/SUBJECTS/LEGAL', body: { inn: 7700, color: 'red', reg_date: 'вчера' } });
            assert.fail('ожидалась ошибка');
        }
        catch (e) {
            assert.ok(e instanceof DataError);
            assert.deepEqual(e.errors.map(x => x.field).sort(), ['color', 'name', 'reg_date']);
        }
    });

    it('создание: приведение типов, статус, подразделение', () => {
        oil = createObject(db, { cid: '/DATA/CATALOGS/SUBJECTS/LEGAL', body: { name: 'ООО «Масла Севера»', inn: 7701234567, kpp: '770101001', reg_date: '2020-03-15' }, author: 'U1', unit: '/BASE/SALES' });
        assert.equal(oil.status, 'active');
        assert.equal(oil.body.inn, '7701234567');
        assert.equal(oil.body.reg_date, '2020-03-15');
        assert.equal(oil.unit, '/BASE/SALES');
        assert.equal(oil.title, 'ООО «Масла Севера»');
        assert.equal(oil.version, 1);
        ivan = createObject(db, { cid: '/DATA/CATALOGS/SUBJECTS/PERSONS', body: { name: 'Иванов Иван', inn: '500100732259' } });
        petr = createObject(db, { cid: '/DATA/CATALOGS/SUBJECTS/LEGAL', body: { name: 'АО «Топливо»', inn: '7802000000' } });
        staffA = createObject(db, { cid: '/DATA/CATALOGS/STAFF', body: { name: 'Смирнова' } });
        staffB = createObject(db, { cid: '/DATA/CATALOGS/STAFF', body: { name: 'Козлов' } });
        assert.throws(() => createObject(db, { cid: '/DATA/CATALOGS/STAFF', body: { name: 'X' }, unit: 'нет' }), /подразделение/);
    });

    it('табличная часть: строки проверяются, числа с пробелами и запятой', () => {
        const g = createObject(db, { cid: '/DATA/CATALOGS/GOODS', body: { name: 'Масло И-40А', base_unit: 'л', units: [{ unit: 'бочка', coef: '216,5' }, { unit: 'канистра', coef: '20' }] } });
        assert.deepEqual(g.body.units, [{ unit: 'бочка', coef: 216.5 }, { unit: 'канистра', coef: 20 }]);
        assert.throws(() => createObject(db, { cid: '/DATA/CATALOGS/GOODS', body: { name: 'X', base_unit: 'т' } }), /нет в списке/);
        assert.throws(() => createObject(db, { cid: '/DATA/CATALOGS/GOODS', body: { name: 'X', units: [{ unit: 'л', coef: 1 }, { unit: 'кг' }] } }), /units\[2\]\.coef — обязательное поле/);
        const p = createObject(db, { cid: '/DATA/OPERATIONS/PAYROLL', body: { staff: [{ employee: staffA.id, sum: '50 000,50' }, { employee: staffB.id, sum: 40000 }] } });
        assert.equal(p.status, 'draft');
        assert.equal(p.body.staff[0].sum, 50000.5);
        assert.deepEqual(referencedBy(db, staffA.id).objects.map(r => [r.field, r.row]), [['staff.employee', 0]]);
    });

    it('ссылка на виртуальный справочник принимает объекты реестра-источника', () => {
        const sale = createObject(db, { cid: '/DATA/OPERATIONS/SALES/RETAIL', body: { client: oil.id, sum: 1000 } });
        assert.equal(sale.body.client, oil.id);
        createObject(db, { cid: '/DATA/OPERATIONS/SALES/RETAIL', body: { client: ivan.id, sum: 10 } });
        assert.throws(() => createObject(db, { cid: '/DATA/OPERATIONS/SALES/RETAIL', body: { client: staffA.id, sum: 1 } }), /не найден в Клиенты/);
        assert.throws(() => createObject(db, { cid: '/DATA/OPERATIONS/SALES/RETAIL', body: { client: 'nope', sum: 1 } }), /не найден/);
    });

    it('запись-расширение виртуального справочника', () => {
        const ext = createObject(db, { cid: '/DATA/CATALOGS/CLIENTS', ext_of: oil.id, body: { manager: staffA.id, discount: 5 } });
        assert.equal(ext.ext_of, oil.id);
        assert.throws(() => createObject(db, { cid: '/DATA/CATALOGS/CLIENTS', ext_of: oil.id, body: {} }), /уже есть/);
        assert.throws(() => createObject(db, { cid: '/DATA/CATALOGS/CLIENTS', body: {} }), /ext_of/);
        assert.throws(() => createObject(db, { cid: '/DATA/CATALOGS/CLIENTS', ext_of: staffA.id, body: {} }), /ext_of/);
        assert.throws(() => createObject(db, { cid: '/DATA/CATALOGS/SUBJECTS/LEGAL', ext_of: oil.id, body: { name: 'X' } }), /только в виртуальном/);
        assert.equal(queryObjects(db, { cid: '/DATA/CATALOGS/CLIENTS', ext_of: oil.id }).items[0].body.discount, 5);
    });

    it('версии во времени: чтение «как было на дату»', () => {
        const v2 = updateObject(db, { id: petr.id, body: { name: 'ПАО «Топливо»' }, valid_from: '2026-09-01', author: 'U2' });
        assert.equal(v2.version, 2);
        assert.equal(v2.body.inn, '7802000000');
        assert.equal(readObject(db, petr.id, { at: '2026-08-15' }).body.name, 'АО «Топливо»');
        assert.equal(readObject(db, petr.id, { at: '2026-09-02' }).body.name, 'ПАО «Топливо»');
        assert.equal(readObject(db, petr.id, { at: '2000-01-01' }).body.name, 'АО «Топливо»');
        assert.throws(() => updateObject(db, { id: petr.id, body: { name: 'X' }, valid_from: '2026-08-01' }), /раньше предыдущей/);
        assert.deepEqual(objectVersions(db, petr.id).map(v => v.version), [1, 2]);
        assert.equal(updateObject(db, { id: petr.id, body: { name: 'ПАО «Топливо»' } }).version, 2, 'без изменений версия не растёт');
        const cleared = updateObject(db, { id: petr.id, body: { inn: null } });
        assert.equal(cleared.body.inn, undefined);
    });

    it('оптимистическая блокировка по версии', () => {
        const cur = readObject(db, ivan.id);
        updateObject(db, { id: ivan.id, body: { name: 'Иванов И. И.' }, version: cur.version });
        assert.throws(() => updateObject(db, { id: ivan.id, body: { name: 'Иванов' }, version: cur.version }), /уже изменён/);
    });

    it('зарегистрированная операция не меняется обычной правкой', () => {
        const op = createObject(db, { cid: '/DATA/OPERATIONS/SALES/RETAIL', body: { client: petr.id, sum: 500 } });
        writeVersion(db, op.id, { status: 'registered', system: true });
        assert.throws(() => updateObject(db, { id: op.id, body: { sum: 1 } }), /только исправлением/);
        assert.throws(() => deleteObject(db, { id: op.id }), /только черновик/);
    });

    it('удаление справочника запрещено, пока на него ссылаются; восстановление', () => {
        assert.throws(() => deleteObject(db, { id: staffB.id }), /используется: объектов — 1/);
        const loner = createObject(db, { cid: '/DATA/CATALOGS/STAFF', body: { name: 'Временный' } });
        const del = deleteObject(db, { id: loner.id, author: 'U1' });
        assert.equal(del.status, 'deleted');
        assert.throws(() => createObject(db, { cid: '/DATA/OPERATIONS/PAYROLL', body: { staff: [{ employee: loner.id, sum: 1 }] } }), /удалён/);
        assert.throws(() => updateObject(db, { id: loner.id, body: { name: 'Y' } }), /удалён/);
        assert.equal(restoreObject(db, { id: loner.id }).status, 'active');
    });

    it('выборки: потомки, поля наследников, поиск по префиксам, сортировка, страницы', () => {
        const all = queryObjects(db, { cid: '/DATA/CATALOGS/SUBJECTS', order: 'name' });
        assert.deepEqual(all.items.map(o => o.title), ['Иванов И. И.', 'ООО «Масла Севера»', 'ПАО «Топливо»']);
        assert.equal(queryObjects(db, { cid: '/DATA/CATALOGS/SUBJECTS', deep: false }).total, 0);
        assert.equal(queryObjects(db, { cid: '/DATA/CATALOGS/SUBJECTS', where: { kpp: '770101001' } }).items[0].id, oil.id);
        assert.equal(queryObjects(db, { cid: '/DATA/CATALOGS/SUBJECTS', where: { inn: { contains: '7701' } } }).total, 1);
        assert.equal(queryObjects(db, { cid: '/DATA/CATALOGS/SUBJECTS', search: 'масл север' }).items[0].id, oil.id);
        assert.equal(queryObjects(db, { cid: '/DATA/CATALOGS/SUBJECTS', search: 'топл' }).total, 1);
        const page = queryObjects(db, { cid: '/DATA/CATALOGS/SUBJECTS', order: '-name', limit: 2, offset: 1 });
        assert.equal(page.total, 3);
        assert.deepEqual(page.items.map(o => o.title), ['ООО «Масла Севера»', 'Иванов И. И.']);
        assert.throws(() => queryObjects(db, { cid: '/DATA/CATALOGS/SUBJECTS', where: { color: 'red' } }), /нет поля «color»/);
        assert.throws(() => queryObjects(db, { cid: '/DATA/CATALOGS/SUBJECTS', where: { inn: { like: 'x' } } }), /не поддерживается/);
    });

    it('выборки: подразделения, период, статусы', () => {
        assert.deepEqual(queryObjects(db, { cid: '/DATA/CATALOGS/SUBJECTS', units: ['/BASE/SALES'] }).items.map(o => o.id), [oil.id]);
        assert.equal(queryObjects(db, { cid: '/DATA/CATALOGS/SUBJECTS', units: [] }).total, 0);
        const today = new Date();
        const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        assert.equal(queryObjects(db, { cid: '/DATA/CATALOGS/STAFF', from: day, to: day, status: ['active', 'deleted'] }).total, 3);
        assert.equal(queryObjects(db, { cid: '/DATA/CATALOGS/STAFF', to: '2000-01-01' }).total, 0);
        assert.equal(queryObjects(db, { cid: '/DATA/OPERATIONS/SALES', status: 'registered' }).total, 1);
        assert.equal(queryObjects(db, { cid: '/DATA/OPERATIONS/SALES', status: 'draft' }).total, 2);
    });

    it('вложенные структуры ($struct): создание, валидация, фильтрация по вложенным полям и полнотекстовый поиск', () => {
        const sidorov = createObject(db, {
            cid: '/DATA/CATALOGS/SUBJECTS/PERSONS',
            body: {
                name: 'Сидоров С. С.',
                passport: { series: '4510', number: '654321', address: { city: 'Рязань', street: 'Почтовая' } },
            },
        });
        assert.deepEqual(sidorov.body.passport, { series: '4510', number: '654321', address: { city: 'Рязань', street: 'Почтовая' } });
        assert.equal(queryObjects(db, { cid: '/DATA/CATALOGS/SUBJECTS', where: { 'passport.series': '4510' } }).items[0].id, sidorov.id);
        assert.equal(queryObjects(db, { cid: '/DATA/CATALOGS/SUBJECTS', where: { 'passport.address.city': 'Рязань' } }).items[0].id, sidorov.id);
        assert.equal(queryObjects(db, { cid: '/DATA/CATALOGS/SUBJECTS', search: 'Почтовая' }).items[0].id, sidorov.id);
        assert.throws(
            () => createObject(db, { cid: '/DATA/CATALOGS/SUBJECTS/PERSONS', body: { name: 'X', passport: { unknown: '1' } } }),
            /passport\.unknown/,
        );
    });

    it('трёхосевое наследование (Types → Ancestor → Parent → Сам класс) и разрешение ссылок внутри $base', async () => {
        cls('MODULES/GEO', '$module', `{ label: 'Гео', METADATA: { FIELDS: [
            { id: 'lat', label: 'Широта из миксина', type: 'Number' },
            { id: 'sum', label: 'Сумма из миксина', type: 'Money' },
            { id: 'note', label: 'Из миксина' } ] } }`);
        cls('ORGANIZATIONS/MY_ORG', '$base', `{ label: 'Моё предприятие' }`);
        cls('ORGANIZATIONS/MY_ORG/DATA/CATALOGS/CLIENTS', '$virtual', `{ label: 'Клиенты базы' }`);
        cls('ORGANIZATIONS/MY_ORG/DATA/OPERATIONS', '$operation', `{ label: 'Операции базы', METADATA: { FIELDS: [
            { id: 'sum', label: 'Сумма из Parent базы', type: 'Money' } ] } }`);
        cls('ORGANIZATIONS/MY_ORG/DATA/OPERATIONS/SALES/RETAIL', '$operation', `{
            label: 'Розница базы',
            types: ['/MODULES/GEO'],
            METADATA: { FIELDS: [{ id: 'note', label: 'Из собственного класса' }, { id: 'local_tag', label: 'Метка' }] }
        }`);
        await refreshClasses(db, tmp);

        const s = classSchema(db, '/ORGANIZATIONS/MY_ORG/DATA/OPERATIONS/SALES/RETAIL');
        assert.equal(s.ancestor, '/DATA/OPERATIONS/SALES/RETAIL');
        assert.deepEqual(s.types, ['/MODULES/GEO']);
        // 1. Types дал lat; 2. Ancestor дал name, sum, client и POSTINGS; 3. Parent базы переопределил sum.label; 4. Own переопределил note.label и добавил local_tag
        assert.equal(s.fields.find(f => f.id === 'lat').label, 'Широта из миксина');
        assert.equal(s.fields.find(f => f.id === 'name').label, 'Наименование', 'унаследовано от Ancestor');
        assert.equal(s.fields.find(f => f.id === 'sum').label, 'Сумма из Parent базы', 'Parent приоритетнее Ancestor и Types');
        assert.equal(s.fields.find(f => f.id === 'note').label, 'Из собственного класса', 'Own приоритетнее всех');
        assert.equal(s.fields.find(f => f.id === 'local_tag').label, 'Метка');
        assert.equal(s.fields.find(f => f.id === 'client').target, '/ORGANIZATIONS/MY_ORG/DATA/CATALOGS/CLIENTS',
            'ссылка на справочник разрешена в локальный класс внутри $base');
        assert.equal(s.postings.length, 1, 'правила проводок унаследованы по Ancestor');
    });
});
