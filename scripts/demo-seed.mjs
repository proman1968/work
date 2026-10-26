/**
 * Начальные данные демо-конфигурации дистрибьютора (docs/architecture-v2.md, раздел 4):
 * виды нормативов и их значения, номенклатура с единицами, склады и резервуары,
 * контрагенты, сотрудники, транспорт. Без нормативов не проводятся налоги, письма, звонки,
 * убыль и доставка.
 *
 *   node scripts/demo-seed.mjs        — в `.data/work.db` (только в пустую базу)
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDataDb } from '../sources/data/db.js';
import { refreshClasses } from '../sources/data/classes.js';
import { createObject, queryObjects } from '../sources/data/objects.js';

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
export function seedDemo(db, { since = `${new Date().getFullYear()}-01-01`, author, prefix = '/DATA' } = {}) {
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const targets = [
        [path.join(root, '.data', 'work.db'), '/DATA'],
        [path.join(root, 'ORGANIZATIONS', 'Маслоторг', '$base', '#system', 'work.db'), '/ORGANIZATIONS/Маслоторг/MODULES/Register'],
    ];
    for (const [dbFile, prefix] of targets) {
        const db = await openDataDb(dbFile);
        const problems = (await refreshClasses(db, root)).problems;
        if (problems.length)
            console.warn(problems.join('\n'));
        if (!queryObjects(db, { cid: `${prefix}/CATALOGS/Виды нормативов`, limit: 1 }).total) {
            const ids = seedDemo(db, { prefix });
            console.log(`[${prefix}] Создано объектов: ${Object.keys(ids).length} (+ ${Object.keys(NORMS).length} нормативов).`);
        }
        db.close();
    }
}
