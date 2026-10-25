/**
 * Выбор значения ссылки (форма, ИИ): кандидаты для поля-ссылки на дату операции.
 *
 * Ссылка на виртуальный справочник («Клиенты», «Работающие сотрудники»):
 *   - без поиска — только состав на дату: коротко и без шума, ведомость зарплаты
 *     заполняется всеми работающими одним запросом;
 *   - с поиском — сначала подходящие участники, затем подходящие объекты
 *     реестра-источника (`member: false`): новый покупатель находится, хотя ещё не клиент;
 *   - `all` — расширить выбор всем реестром и без поиска;
 *   - ничего не нашлось — `create`: классы, где создать объект и сразу сослаться на него.
 * Проведение состав не проверяет: участником объект делает сама операция
 * (первая продажа делает покупателя клиентом).
 *
 * Ссылка на обычный справочник — его объекты (с потомками), с поиском.
 */
import { getClass, descendants, isLeaf } from './classes.js';
import { classSchema } from './schema.js';
import { queryObjects } from './objects.js';
import { virtualMembers } from './reports.js';
import { entryGrants, withoutBranches } from './scope.js';
import { DataError } from './errors.js';

const POOL = 500;
const byTitle = (a, b) => a.title.localeCompare(b.title, 'ru');

/** Целевой класс: `target` или поле класса `cid` (`field`, для табличной части — 'таблица.поле'). */
function resolveTarget(db, q) {
    if (q.target)
        return String(q.target);
    const schema = classSchema(db, q.cid);
    if (!schema)
        throw new DataError(`класс ${q.cid ?? ''} не найден`);
    const [head, tail] = String(q.field ?? '').split('.');
    let f = schema.fields.find(x => x.id === head);
    if (f && tail)
        f = f.type === 'table' ? f.fields.find(x => x.id === tail) : null;
    if (!f || f.type !== 'link')
        throw new DataError(`${schema.label}: поле «${q.field ?? ''}» — не ссылка`);
    return f.target;
}

/** Классы-листы справочника, где можно создать объект. */
function creatable(db, cid) {
    return descendants(db, cid)
        .filter(c => isLeaf(db, c))
        .map(c => getClass(db, c))
        .filter(c => c.type === '$catalog' || c.type === '$registry')
        .map(c => ({ cid: c.cid, path: c.path, label: c.label }));
}

const plain = o => ({ id: o.id, cid: o.cid, title: o.title });

/**
 * Кандидаты для поля-ссылки.
 * @param {object} q
 * @param {string} [q.target] Класс ссылки (или `cid` + `field`)
 * @param {string} [q.cid] Класс объекта, где поле
 * @param {string} [q.field] Поле ('client', 'staff.employee')
 * @param {*} [q.at] Дата операции: состав виртуального справочника на неё
 * @param {string} [q.search] Поиск по началам слов
 * @param {boolean} [q.all] Показать и объекты реестра вне состава (без поиска)
 * @param {number} [q.limit=200]
 * @param {Array<object>|null} [q.visible] Права видимости справочника (scope.js); у виртуального — проводок состава
 * @param {Array<object>|null} [q.registryVisible] Права на объекты реестра виртуального (по умолчанию — `visible` без веток)
 * @returns {{ target, virtual: boolean, items: Array<{ id, cid, title, member, balance?, ext? }>,
 *             total: number, others: number, create: Array<{ cid, label }> }}
 *   total — всего подходящих; others — объектов реестра вне показанного состава (кнопка «показать все»)
 */
export function linkChoices(db, q = {}) {
    const target = resolveTarget(db, q);
    const schema = classSchema(db, target);
    if (!schema || schema.family !== 'catalog')
        throw new DataError(`справочник ${target} не найден`);
    const limit = Math.max(1, Math.min(1000, Number(q.limit) || 200));
    const search = String(q.search ?? '').trim() || undefined;

    if (schema.type !== '$virtual') {
        const r = queryObjects(db, { cid: schema.cid, search, limit: POOL, visible: q.visible });
        return {
            target: schema.cid,
            virtual: false,
            items: r.items.map(o => ({ ...plain(o), member: true })).sort(byTitle).slice(0, limit),
            total: r.total,
            others: 0,
            create: creatable(db, schema.cid),
        };
    }

    const registry = getClass(db, schema.source?.registry);
    const members = virtualMembers(db, {
        cid: schema.cid, at: q.at, units: q.units, unit: q.unit, visible: entryGrants(q.visible, 'catalog'),
    }).items;
    const member = m => ({ id: m.id, cid: m.cid, title: m.title, member: true, balance: m.balance, ext: m.ext });
    const create = creatable(db, registry.cid);
    const regVisible = q.registryVisible !== undefined ? q.registryVisible : withoutBranches(q.visible);
    const regTotal = queryObjects(db, { cid: registry.cid, limit: 1, visible: regVisible }).total;

    if (!search && !q.all)
        return {
            target: schema.cid,
            virtual: true,
            items: members.slice(0, limit).map(member),
            total: members.length,
            others: Math.max(0, regTotal - members.length),
            create,
        };

    const pool = queryObjects(db, { cid: registry.cid, search, limit: POOL, visible: regVisible });
    const found = new Set(pool.items.map(o => o.id));
    const ids = new Set(members.map(m => m.id));
    const items = [
        ...members.filter(m => !search || found.has(m.id)).map(member),
        ...pool.items.filter(o => !ids.has(o.id)).map(o => ({ ...plain(o), member: false })).sort(byTitle),
    ];
    return {
        target: schema.cid,
        virtual: true,
        items: items.slice(0, limit),
        total: pool.total,
        others: 0,
        create,
    };
}
