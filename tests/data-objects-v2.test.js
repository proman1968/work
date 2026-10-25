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
    cls('BASE', '$base', `{ CID: 'org', label: 'Организация' }`);
    cls('BASE/SALES', '$structure', `{ CID: 'unit.sales', label: 'Отдел продаж' }`);
    cls('BASE/STOCK', '$structure', `{ CID: 'unit.stock', label: 'Склад' }`);

    cls('DATA/CATALOGS', '$catalog', `{ CID: 'catalogs', label: 'Справочники' }`);
    cls('DATA/CATALOGS/SUBJECTS', '$catalog', `{ CID: 'subjects', label: 'Субъекты', METADATA: { FIELDS: [
        { id: 'name', label: 'Наименование', required: true }, { id: 'inn', label: 'ИНН' }, { id: 'reg_date', type: 'date' } ] } }`);
    cls('DATA/CATALOGS/SUBJECTS/LEGAL', '$catalog', `{ CID: 'legal', label: 'Юридические лица', METADATA: { FIELDS: [{ id: 'kpp', label: 'КПП' }] } }`);
    cls('DATA/CATALOGS/SUBJECTS/PERSONS', '$catalog', `{ CID: 'persons', label: 'Физические лица', METADATA: { FIELDS: [{ id: 'inn', label: 'ИНН физлица' }] } }`);
    cls('DATA/CATALOGS/STAFF', '$catalog', `{ CID: 'staff', label: 'Сотрудники', METADATA: { FIELDS: [{ id: 'name', required: true }] } }`);
    cls('DATA/CATALOGS/CLIENTS', '$virtual', `{ CID: 'clients', label: 'Клиенты',
        SOURCE: { registry: 'subjects', account: '62', slot: 'counterparty' },
        OVERLAY: [{ id: 'manager', type: 'Link', target: 'staff', label: 'Менеджер' }, { id: 'discount', type: 'Number' }] }`);
    cls('DATA/CATALOGS/GOODS', '$catalog', `{ CID: 'goods', label: 'Номенклатура', METADATA: { FIELDS: [
        { id: 'name', required: true }, { id: 'base_unit', type: 'enum', values: ['л', 'кг', 'шт'] },
        { id: 'units', type: 'Table', FIELDS: [{ id: 'unit', required: true }, { id: 'coef', type: 'Number', required: true }] } ] } }`);

    cls('DATA/REGISTER', '$register', `{ CID: 'register', label: 'Журнал' }`);
    cls('DATA/REGISTER/62', '$account', `{ CID: '62', label: 'Расчёты с покупателями', METADATA: { FIELDS: [
        { id: 'counterparty', type: 'Link', catalog: 'subjects', analytic: true } ] } }`);
    cls('DATA/REGISTER/62/62.01', '$account', `{ CID: '62.01', label: 'Расчёты в рублях' }`);
    cls('DATA/REGISTER/90', '$account', `{ CID: '90', label: 'Продажи' }`);
    cls('DATA/REGISTER/26', '$account', `{ CID: '26', label: 'Общехозяйственные расходы' }`);
    cls('DATA/REGISTER/69', '$account', `{ CID: '69', label: 'Страховые взносы' }`);
    cls('DATA/REGISTER/70', '$account', `{ CID: '70', label: 'Расчёты с персоналом', METADATA: { FIELDS: [
        { id: 'employee', type: 'Link', target: 'staff', analytic: true } ] } }`);

    cls('DATA/OPERATIONS', '$operation', `{ CID: 'ops', label: 'Операции', METADATA: { FIELDS: [
        { id: 'name', label: 'Наименование' }, { id: 'sum', type: 'Money', label: 'Сумма' }, { id: 'note', to_inherit: false } ] } }`);
    cls('DATA/OPERATIONS/SALES', '$operation', `{ CID: 'sales', label: 'Реализация', METADATA: {
        FIELDS: [{ id: 'client', type: 'Link', catalog: 'clients', required: true }],
        POSTINGS: [{ id: 'main', amount: 'sum', debit: { account: '62.01', analytics: { counterparty: 'client' } }, credit: { account: '90' } }] } }`);
    cls('DATA/OPERATIONS/SALES/RETAIL', '$operation', `{ CID: 'retail', label: 'Розница' }`);
    cls('DATA/OPERATIONS/SALES/WHOLESALE', '$operation', `{ CID: 'wholesale', label: 'Опт', AUTO_REGISTER: true, METADATA: {
        FIELDS: [{ id: 'name', removed: true }, { id: 'contract', label: 'Договор' }],
        POSTINGS: [{ id: 'main', amount: 'round(sum * 1, 2)', quantity: 1 }] } }`);
    cls('DATA/OPERATIONS/PAYROLL', '$operation', `{ CID: 'payroll', label: 'Начисление зарплаты', METADATA: {
        FIELDS: [{ id: 'staff', type: 'Table', label: 'Ведомость', required: true, FIELDS: [
            { id: 'employee', type: 'Link', target: 'staff', required: true }, { id: 'sum', type: 'Money', required: true } ] }],
        POSTINGS: [
            { id: 'accrual', each: 'staff', amount: 'row.sum', debit: { account: '26' }, credit: { account: '70', analytics: { employee: 'row.employee' } } },
            { id: 'taxes', each: 'staff', amount: "round(row.sum * norm('Ставка взносов'), 2)", debit: { account: '26' }, credit: { account: '69' } } ] } }`);
    cls('DATA/OPERATIONS/BROKEN', '$operation', `{ CID: 'broken', label: 'Сломанная', METADATA: {
        POSTINGS: [
            { id: 'a', amount: 'foo + 1', debit: { account: '62' }, credit: { account: '999' } },
            { id: 'b', amount: 'sum', debit: { account: '62.01', analytics: { other: 'sum' } }, credit: { account: '90' } },
            { id: 'c', debit: { account: '90' }, credit: { account: '26' } },
            { id: 'd', amount: 'evil(sum)', each: 'sum', debit: { account: '90' } } ] } }`);

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
        assert.deepEqual(classSchema(db, 'retail').fields.map(f => f.id), ['name', 'sum', 'client']);
        assert.deepEqual(classSchema(db, 'ops').fields.map(f => f.id), ['name', 'sum', 'note']);
    });

    it('потомок уточняет поле, removed убирает, новые поля — в конец', () => {
        assert.equal(classSchema(db, 'persons').fields.find(f => f.id === 'inn').label, 'ИНН физлица');
        assert.equal(classSchema(db, 'legal').fields.find(f => f.id === 'inn').label, 'ИНН');
        assert.deepEqual(classSchema(db, 'wholesale').fields.map(f => f.id), ['sum', 'client', 'contract']);
    });

    it('типы нормализуются: Money, timestamp, Link+catalog → link+target, Table с полями', () => {
        const sale = classSchema(db, 'retail');
        assert.equal(sale.fields.find(f => f.id === 'sum').type, 'money');
        const client = sale.fields.find(f => f.id === 'client');
        assert.equal(client.type, 'link');
        assert.equal(client.target, 'clients');
        const units = classSchema(db, 'goods').fields.find(f => f.id === 'units');
        assert.equal(units.type, 'table');
        assert.deepEqual(units.fields.map(f => [f.id, f.type]), [['unit', 'string'], ['coef', 'number']]);
    });

    it('правила проводок сливаются по id: лист уточняет сумму, счета наследует; quantity → qty', () => {
        const main = classSchema(db, 'wholesale').postings.find(r => r.id === 'main');
        assert.equal(main.amount, 'round(sum * 1, 2)');
        assert.equal(main.qty, 1);
        assert.equal(main.debit.account, '62.01');
        assert.deepEqual(main.debit.analytics, { counterparty: 'client' });
        assert.equal(classSchema(db, 'wholesale').autoRegister, true);
        assert.equal(classSchema(db, 'retail').autoRegister, false);
    });

    it('схема семейства не смешивается с предками другого типа', () => {
        assert.deepEqual(classSchema(db, '62.01').fields.map(f => f.id), ['counterparty']);
        assert.equal(classSchema(db, '62.01').family, 'account');
        assert.equal(classSchema(db, 'clients').source.registry, 'subjects');
        assert.deepEqual(classSchema(db, 'clients').overlay.map(f => f.id), ['manager', 'discount']);
    });

    it('корректные листья проходят проверку', () => {
        for (const cid of ['retail', 'wholesale', 'payroll', 'legal', 'goods', 'clients', '62.01'])
            assert.deepEqual(checkSchema(db, cid), [], cid);
    });

    it('ошибки правил листа: не лист, нет счёта, неизвестное поле и функция, аналитики, each', () => {
        const errors = checkSchema(db, 'broken').join('\n');
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
        assert.equal(classSchema(db, 'staff').label, 'Сотрудники');
        const file = path.join(tmp, 'DATA/CATALOGS/STAFF/$catalog/class.js');
        fs.writeFileSync(file, `export default { CID: 'staff', label: 'Персонал', METADATA: { FIELDS: [{ id: 'name', required: true }] } }`, 'utf-8');
        const later = new Date(Date.now() + 5000);
        fs.utimesSync(file, later, later);
        await refreshClasses(db, tmp);
        assert.equal(classSchema(db, 'staff').label, 'Персонал');
    });
});

describe('объекты', () => {
    let oil, ivan, petr, staffA, staffB;

    it('создаются только в листе своего семейства', () => {
        assert.throws(() => createObject(db, { cid: 'subjects', body: { name: 'X' } }), /только в конечном классе/);
        assert.throws(() => createObject(db, { cid: '62.01', body: {} }), /объекты не создаются/);
        assert.throws(() => createObject(db, { cid: 'нет', body: {} }), /не найден/);
    });

    it('проверка тела: обязательные, лишние поля, типы — все ошибки сразу', () => {
        try {
            createObject(db, { cid: 'legal', body: { inn: 7700, color: 'red', reg_date: 'вчера' } });
            assert.fail('ожидалась ошибка');
        }
        catch (e) {
            assert.ok(e instanceof DataError);
            assert.deepEqual(e.errors.map(x => x.field).sort(), ['color', 'name', 'reg_date']);
        }
    });

    it('создание: приведение типов, статус, подразделение', () => {
        oil = createObject(db, { cid: 'legal', body: { name: 'ООО «Масла Севера»', inn: 7701234567, kpp: '770101001', reg_date: '2020-03-15' }, author: 'U1', unit: 'unit.sales' });
        assert.equal(oil.status, 'active');
        assert.equal(oil.body.inn, '7701234567');
        assert.equal(oil.body.reg_date, '2020-03-15');
        assert.equal(oil.unit, 'unit.sales');
        assert.equal(oil.title, 'ООО «Масла Севера»');
        assert.equal(oil.version, 1);
        ivan = createObject(db, { cid: 'persons', body: { name: 'Иванов Иван', inn: '500100732259' } });
        petr = createObject(db, { cid: 'legal', body: { name: 'АО «Топливо»', inn: '7802000000' } });
        staffA = createObject(db, { cid: 'staff', body: { name: 'Смирнова' } });
        staffB = createObject(db, { cid: 'staff', body: { name: 'Козлов' } });
        assert.throws(() => createObject(db, { cid: 'staff', body: { name: 'X' }, unit: 'нет' }), /подразделение/);
    });

    it('табличная часть: строки проверяются, числа с пробелами и запятой', () => {
        const g = createObject(db, { cid: 'goods', body: { name: 'Масло И-40А', base_unit: 'л', units: [{ unit: 'бочка', coef: '216,5' }, { unit: 'канистра', coef: '20' }] } });
        assert.deepEqual(g.body.units, [{ unit: 'бочка', coef: 216.5 }, { unit: 'канистра', coef: 20 }]);
        assert.throws(() => createObject(db, { cid: 'goods', body: { name: 'X', base_unit: 'т' } }), /нет в списке/);
        assert.throws(() => createObject(db, { cid: 'goods', body: { name: 'X', units: [{ unit: 'л', coef: 1 }, { unit: 'кг' }] } }), /units\[2\]\.coef — обязательное поле/);
        const p = createObject(db, { cid: 'payroll', body: { staff: [{ employee: staffA.id, sum: '50 000,50' }, { employee: staffB.id, sum: 40000 }] } });
        assert.equal(p.status, 'draft');
        assert.equal(p.body.staff[0].sum, 50000.5);
        assert.deepEqual(referencedBy(db, staffA.id).objects.map(r => [r.field, r.row]), [['staff.employee', 0]]);
    });

    it('ссылка на виртуальный справочник принимает объекты реестра-источника', () => {
        const sale = createObject(db, { cid: 'retail', body: { client: oil.id, sum: 1000 } });
        assert.equal(sale.body.client, oil.id);
        createObject(db, { cid: 'retail', body: { client: ivan.id, sum: 10 } });
        assert.throws(() => createObject(db, { cid: 'retail', body: { client: staffA.id, sum: 1 } }), /не найден в Клиенты/);
        assert.throws(() => createObject(db, { cid: 'retail', body: { client: 'nope', sum: 1 } }), /не найден/);
    });

    it('запись-расширение виртуального справочника', () => {
        const ext = createObject(db, { cid: 'clients', ext_of: oil.id, body: { manager: staffA.id, discount: 5 } });
        assert.equal(ext.ext_of, oil.id);
        assert.throws(() => createObject(db, { cid: 'clients', ext_of: oil.id, body: {} }), /уже есть/);
        assert.throws(() => createObject(db, { cid: 'clients', body: {} }), /ext_of/);
        assert.throws(() => createObject(db, { cid: 'clients', ext_of: staffA.id, body: {} }), /ext_of/);
        assert.throws(() => createObject(db, { cid: 'legal', ext_of: oil.id, body: { name: 'X' } }), /только в виртуальном/);
        assert.equal(queryObjects(db, { cid: 'clients', ext_of: oil.id }).items[0].body.discount, 5);
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
        const op = createObject(db, { cid: 'retail', body: { client: petr.id, sum: 500 } });
        writeVersion(db, op.id, { status: 'registered', system: true });
        assert.throws(() => updateObject(db, { id: op.id, body: { sum: 1 } }), /только исправлением/);
        assert.throws(() => deleteObject(db, { id: op.id }), /только черновик/);
    });

    it('удаление справочника запрещено, пока на него ссылаются; восстановление', () => {
        assert.throws(() => deleteObject(db, { id: staffB.id }), /используется: объектов — 1/);
        const loner = createObject(db, { cid: 'staff', body: { name: 'Временный' } });
        const del = deleteObject(db, { id: loner.id, author: 'U1' });
        assert.equal(del.status, 'deleted');
        assert.throws(() => createObject(db, { cid: 'payroll', body: { staff: [{ employee: loner.id, sum: 1 }] } }), /удалён/);
        assert.throws(() => updateObject(db, { id: loner.id, body: { name: 'Y' } }), /удалён/);
        assert.equal(restoreObject(db, { id: loner.id }).status, 'active');
    });

    it('выборки: потомки, поля наследников, поиск по префиксам, сортировка, страницы', () => {
        const all = queryObjects(db, { cid: 'subjects', order: 'name' });
        assert.deepEqual(all.items.map(o => o.title), ['Иванов И. И.', 'ООО «Масла Севера»', 'ПАО «Топливо»']);
        assert.equal(queryObjects(db, { cid: 'subjects', deep: false }).total, 0);
        assert.equal(queryObjects(db, { cid: 'subjects', where: { kpp: '770101001' } }).items[0].id, oil.id);
        assert.equal(queryObjects(db, { cid: 'subjects', where: { inn: { contains: '7701' } } }).total, 1);
        assert.equal(queryObjects(db, { cid: 'subjects', search: 'масл север' }).items[0].id, oil.id);
        assert.equal(queryObjects(db, { cid: 'subjects', search: 'топл' }).total, 1);
        const page = queryObjects(db, { cid: 'subjects', order: '-name', limit: 2, offset: 1 });
        assert.equal(page.total, 3);
        assert.deepEqual(page.items.map(o => o.title), ['ООО «Масла Севера»', 'Иванов И. И.']);
        assert.throws(() => queryObjects(db, { cid: 'subjects', where: { color: 'red' } }), /нет поля «color»/);
        assert.throws(() => queryObjects(db, { cid: 'subjects', where: { inn: { like: 'x' } } }), /не поддерживается/);
    });

    it('выборки: подразделения, период, статусы', () => {
        assert.deepEqual(queryObjects(db, { cid: 'subjects', units: ['unit.sales'] }).items.map(o => o.id), [oil.id]);
        assert.equal(queryObjects(db, { cid: 'subjects', units: [] }).total, 0);
        const today = new Date();
        const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        assert.equal(queryObjects(db, { cid: 'staff', from: day, to: day, status: ['active', 'deleted'] }).total, 3);
        assert.equal(queryObjects(db, { cid: 'staff', to: '2000-01-01' }).total, 0);
        assert.equal(queryObjects(db, { cid: 'sales', status: 'registered' }).total, 1);
        assert.equal(queryObjects(db, { cid: 'sales', status: 'draft' }).total, 2);
    });
});
