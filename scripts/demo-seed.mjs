/**
 * Начальные данные демо-конфигурации дистрибьютора (docs/architecture-v2.md, раздел 4):
 * виды нормативов и их значения, номенклатура с единицами, склады и резервуары,
 * контрагенты, сотрудники, транспорт. Без нормативов не проводятся налоги, письма, звонки,
 * убыль и доставка.
 *
 *   node scripts/demo-seed.mjs        — в `.data/work.db` (только в пустую базу)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDataDb } from '../sources/data/db.js';
import { refreshClasses } from '../sources/data/classes.js';
import { createObject, queryObjects } from '../sources/data/objects.js';
import { registerOperation } from '../sources/data/posting.js';

/** Нормативы демо-конфигурации: вид → [единица, значение]. */
export const NORMS = Object.freeze({
    'Ставка НДС': ['доля', 0.2],
    'Ставка НДФЛ': ['доля', 0.13],
    'Ставка страховых взносов': ['доля', 0.302],
    'Стоимость письма': ['руб.', 50],
    'Стоимость минуты звонка': ['руб.', 5],
    'Норма естественной убыли': ['доля от базы', 0.0005],
    'Расход топлива, л/км': ['л/км', 0.3],
    'Учётная цена топлива': ['руб./л', 58],
});

/**
 * Заполнить базу начальными данными.
 * @param {import('node:sqlite').DatabaseSync} db Классы дерева уже загружены (refreshClasses)
 * @param {object} [opts] { since — с какого дня действуют нормативы (по умолчанию 1 января текущего года), author }
 * @returns {Record<string, string>} id созданных объектов по коротким именам
 */
export function seedDemo(db, { since = `${new Date().getFullYear()}-01-01`, author, prefix = '/ORGANIZATIONS/Маслоторг/MODULES/Register' } = {}) {
    const ids = {};
    const make = (key, cid, body, extra = {}) => {
        ids[key] = createObject(db, { cid, body, author, ...extra }).id;
        return ids[key];
    };

    for (const [name, [unit]] of Object.entries(NORMS))
        make(`kind:${name}`, `${prefix}/CATALOGS/Виды нормативов`, { name, unit });
    for (const [name, [, value]] of Object.entries(NORMS))
        createObject(db, { cid: `${prefix}/OPERATIONS/Установка норматива`, time: since, author, body: { kind: ids[`kind:${name}`], value } });

    make('oil', `${prefix}/CATALOGS/Номенклатура`, {
        name: 'Масло моторное 10W-40', kind: 'Масло', base_unit: 'л', density: 0.88,
        units: [{ unit: 'канистра', coef: 20, price: 3200 }, { unit: 'бочка', coef: 200, price: 30000 }, { unit: 'IBC', coef: 1000, price: 150000 }],
    });
    make('diesel', `${prefix}/CATALOGS/Номенклатура`, { name: 'Дизельное топливо', kind: 'Топливо', base_unit: 'л', density: 0.84 });
    make('canister', `${prefix}/CATALOGS/Номенклатура`, { name: 'Канистра 20 л', kind: 'Тара', base_unit: 'шт' });
    make('barrel', `${prefix}/CATALOGS/Номенклатура`, { name: 'Бочка 200 л', kind: 'Тара', base_unit: 'шт' });

    make('tank', `${prefix}/CATALOGS/Склады и резервуары`, { name: 'Резервуар Р-1', kind: 'Резервуар', capacity: 50000, item: ids.oil });
    make('stock', `${prefix}/CATALOGS/Склады и резервуары`, { name: 'Склад готовой продукции', kind: 'Склад' });
    make('fuel_stock', `${prefix}/CATALOGS/Склады и резервуары`, { name: 'Склад ГСМ', kind: 'Склад' });

    make('supplier', `${prefix}/CATALOGS/Субъекты/Юр. лица`, { name: 'ООО «Нефтехим-Поставка»', inn: '7701000001' });
    make('client', `${prefix}/CATALOGS/Субъекты/Юр. лица`, { name: 'ООО «Автосервис Плюс»', inn: '7701000002' });
    make('ivanov', `${prefix}/CATALOGS/Субъекты/Физ. лица`, { name: 'Иванов Иван Иванович' });
    make('petrov', `${prefix}/CATALOGS/Субъекты/Физ. лица`, { name: 'Петров Пётр Петрович' });
    make('truck', `${prefix}/CATALOGS/Транспорт`, { name: 'Бензовоз КамАЗ', plate: 'А123ВС77', kind: 'Бензовоз', capacity: 10000, fuel: ids.diesel });
    return ids;
}

/**
 * Провести стартовый пакет демо-операций (поступление, фасовка, реализация, платежи, кадры, зарплата, письмо).
 */
export function seedDemoOperations(db, ids, { year = new Date().getFullYear(), author = 'demo', prefix = '/ORGANIZATIONS/Маслоторг/MODULES/Register', orgBase = '/ORGANIZATIONS/Маслоторг' } = {}) {
    const d = md => `${year}-${md}`;
    const post = (subpath, md, body, unitSub, place = 'head') => {
        const o = createObject(db, {
            cid: `${prefix}${subpath}`,
            time: d(md),
            author,
            unit: `${orgBase}/${unitSub}`,
            place,
            body,
        });
        if (o.status !== 'registered')
            registerOperation(db, { id: o.id, author });
        return o;
    };

    post('/OPERATIONS/Поступление товара', '02-01', {
        supplier: ids.supplier, storage: ids.tank, vat_sum: 30000,
        lines: [{ item: ids.oil, unit: 'бочка', qty: 5, price: 30000, density: 0.88 }],
    }, 'warehouse', 'head');

    post('/OPERATIONS/Поступление товара', '02-02', {
        supplier: ids.supplier, storage: ids.stock, vat_sum: 2000,
        lines: [{ item: ids.canister, unit: 'шт', qty: 100, price: 100 }],
    }, 'warehouse', 'head');

    post('/OPERATIONS/Поступление товара', '03-05', {
        supplier: ids.supplier, storage: ids.fuel_stock, vat_sum: 11000,
        lines: [{ item: ids.diesel, unit: 'л', qty: 1000, price: 55, density: 0.84 }],
    }, 'warehouse', 'head');

    post('/OPERATIONS/Фасовка', '04-15', {
        item: ids.oil, from_storage: ids.tank, to_storage: ids.stock,
        lines: [{ unit: 'канистра', qty: 20, container: ids.canister }],
    }, 'warehouse', 'head');

    post('/OPERATIONS/Реализация/Покупателю', '05-20', {
        client: ids.client, storage: ids.stock,
        lines: [{ item: ids.oil, unit: 'канистра', qty: 10, price: 3200 }],
    }, 'sales', 'head/manager');

    post('/OPERATIONS/Реализация/Покупателю', '08-14', {
        client: ids.client, storage: ids.tank,
        lines: [{ item: ids.oil, unit: 'л', qty: 100, price: 240 }],
    }, 'sales', 'head/manager');

    post('/OPERATIONS/Поступления на расчётный счёт/От покупателя', '09-01', {
        counterparty: ids.client, sum: 38400, purpose: 'Оплата по счёту за масло',
    }, 'finances', 'head');

    post('/OPERATIONS/Платежи с расчётного счёта/Поставщику', '09-10', {
        counterparty: ids.supplier, sum: 120000, purpose: 'Оплата поставщику за ГСМ',
    }, 'finances', 'head');

    post('/OPERATIONS/Кадры/Приём на работу', '01-15', {
        person: ids.ivanov, position: 'Менеджер по продажам', salary: 100000,
    }, 'personal', 'head');

    post('/OPERATIONS/Кадры/Приём на работу', '01-15', {
        person: ids.petrov, position: 'Водитель бензовоза', salary: 80000,
    }, 'personal', 'head');

    post('/OPERATIONS/Зарплата', '09-30', {
        period: d('09-01'),
        staff: [
            { employee: ids.ivanov, sum: 100000 },
            { employee: ids.petrov, sum: 80000 },
        ],
    }, 'finances', 'head');

    post('/OPERATIONS/Коммуникации/Письмо', '10-05', {
        counterparty: ids.client, direction: 'Исходящее',
    }, 'sales', 'head/manager');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const targets = [
        [path.join(root, 'ORGANIZATIONS', 'Маслоторг', '$base', '#system', 'work.db'), '/ORGANIZATIONS/Маслоторг/MODULES/Register', '/ORGANIZATIONS/Маслоторг'],
    ];
    for (const [dbFile, prefix, orgBase] of targets) {
        const db = await openDataDb(dbFile);
        const problems = (await refreshClasses(db, root)).problems;
        if (problems.length)
            console.warn(problems.join('\n'));
        let ids;
        if (!queryObjects(db, { cid: `${prefix}/CATALOGS/Виды нормативов`, limit: 1 }).total) {
            ids = seedDemo(db, { prefix });
            console.log(`[${prefix}] Создано объектов справочников: ${Object.keys(ids).length} (+ ${Object.keys(NORMS).length} нормативов).`);
        }
        if (ids && !queryObjects(db, { cid: `${prefix}/OPERATIONS/Поступление товара`, limit: 1 }).total) {
            seedDemoOperations(db, ids, { prefix, orgBase });
            console.log(`[${prefix}] Проведены стартовые демо-операции.`);
        }
        db.close();
    }

    const delovayaDb = path.join(root, 'ORGANIZATIONS', 'Деловая сфера', '$base', '#system', 'work.db');
    const workParent = 'D:/business/d.WORK';
    if (!fs.existsSync(delovayaDb) && fs.existsSync(workParent)) {
        const found = fs.readdirSync(workParent).find(d => d.includes('Деловая'));
        if (found) {
            const { importDelovayaData } = await import('./import-delovaya.mjs');
            const res = await importDelovayaData(path.join(workParent, found));
            console.log(`[/ORGANIZATIONS/Деловая сфера] Импортировано объектов: ${res.stats.catalogs + res.stats.operations}, двойных проводок: ${res.stats.doubleEntries}.`);
        }
    }

    const bisDb = path.join(root, 'ORGANIZATIONS', 'Бизнес Интер Софт', '$base', '#system', 'work.db');
    if (!fs.existsSync(bisDb) && fs.existsSync(workParent)) {
        const found = fs.readdirSync(workParent).find(d => d.includes('Бизнес_Инт'));
        if (found) {
            const { importBisData } = await import('./import-bis.mjs');
            const res = await importBisData(path.join(workParent, found));
            console.log(`[/ORGANIZATIONS/Бизнес Интер Софт] Импортировано объектов: ${res.stats.catalogs + res.stats.operations}, двойных проводок: ${res.stats.doubleEntries}.`);
        }
    }
}
