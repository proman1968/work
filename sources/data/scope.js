/**
 * Видимость данных по `scope` ссылок рабочих мест (docs/architecture-v2.md, Р8).
 *
 * Ссылка подразделения на класс (`#security.LINKS` места или общая) несёт `scope`:
 * `own` — свои объекты (автор), `place` — объекты своего места, `unit` — подразделения
 * с вложенными, `all` — все. Без `scope`: справочники — `all`, операции и счета — `unit`.
 * Отношение пользователя к ссылке (`scopeLinks` в sources/server/access/links.js):
 * `member` — scope ссылки; `ancestor` (вышестоящее место видит ссылки вложенных) — то же,
 * но «свои» и «место» — объекты вложенного места; `boss` — подразделение с вложенными
 * (`all` остаётся `all`); `admin` — всё.
 *
 * Ссылка на класс вызова или его предка открывает всё поддерево класса, ссылка ниже —
 * только свою ветку: сводный отчёт предка строится по видимым веткам.
 *
 * Право (grant) — `{ cids?, units?, places?, author? }`: ветка классов, подразделения,
 * пары [подразделение, место], автор. Условия права — И, права между собой — ИЛИ.
 * Список прав `null` — видно всё, `[]` — ничего. Для проводок ветка становится
 * счетами (`accounts`) или классами операций (`ops`) — `entryGrants`.
 *
 * Место хранится путём в дереве ROLES подразделения ('heads/ceo') и имеет смысл только
 * вместе с подразделением (`unit` — cid структуры).
 */
import { getClass, descendants } from './classes.js';
import { FAMILY } from './schema.js';
import { DataError } from './errors.js';

export const SCOPES = Object.freeze(['own', 'place', 'unit', 'all']);

const isEmpty = v => v === undefined || v === null || v === '';
const under = (path, id) => path === id || path.startsWith(id + '/');

/** Видимость по ссылке без `scope`: справочники — все объекты, операции и счета — подразделения. */
export function defaultScope(type) {
    return FAMILY[type] === 'catalog' ? 'all' : 'unit';
}

/** Подразделение ссылки: cid структуры в кэше классов, иначе путь. */
function unitOf(db, structure) {
    return getClass(db, structure)?.cid ?? structure;
}

function unitTree(db, unit) {
    const list = descendants(db, unit);
    return list.length ? list : [unit];
}

/** Условия строк права по ссылке и её отношению к пользователю. */
function rowsOf(db, link, scope, uid) {
    const unit = unitOf(db, link.structure);
    if (link.relation === 'admin' || scope === 'all')
        return {};
    if (link.relation === 'boss' || scope === 'unit')
        return { units: unitTree(db, unit) };
    if (link.relation === 'ancestor')
        return { places: [[unit, link.place]] };
    if (scope === 'place') {
        const places = link.place ? [link.place] : link.places ?? [];
        if (places.length)
            return { places: places.map(p => [unit, p]) };
    }
    return { author: uid ?? '' };
}

/**
 * Права видимости данных через класс вызова.
 * @param {object} cls Класс вызова из кэша (cid, path, type)
 * @param {Array<{ structure, place, id, access, scope, relation, places }>} links Ссылки пользователя (scopeLinks)
 * @param {object} [opts] { uid, write — только ссылки с правом записи }
 * @returns {Array<object>|null} null — видно всё
 */
export function scopeGrants(db, cls, links, { uid, write = false } = {}) {
    const grants = new Map();
    for (const l of links || []) {
        if (write && l.access !== 'write' && l.access !== 'admin')
            continue;
        let branch = null, type = cls.type;
        if (!under(cls.path, l.id)) {
            if (!l.id.startsWith(cls.path + '/'))
                continue;
            const c = getClass(db, l.id);
            if (!c)
                continue;
            branch = descendants(db, c.cid);
            if (FAMILY[c.type])
                type = c.type;
        }
        const rows = rowsOf(db, l, SCOPES.includes(l.scope) ? l.scope : defaultScope(type), uid);
        if (!branch && !Object.keys(rows).length)
            return null;
        const g = branch ? { cids: branch, ...rows } : rows;
        grants.set(JSON.stringify(g), g);
    }
    return [...grants.values()];
}

/** Права без веток (чтение реестра через виртуальный справочник, проводки объекта). */
export function withoutBranches(grants) {
    return grants && grants.map(({ cids, ...rows }) => rows);
}

/**
 * Права на проводки отчёта: ветка класса-счёта — счета стороны, класса операций — класс
 * операции; у справочника ветка лишь выбирает права объекта `objectCid` (без него — все).
 */
export function entryGrants(grants, family, objectCid) {
    if (grants == null)
        return null;
    const out = [];
    for (const { cids, ...rows } of grants) {
        if (!cids)
            out.push(rows);
        else if (family === 'account')
            out.push({ accounts: cids, ...rows });
        else if (family === 'operation')
            out.push({ ops: cids, ...rows });
        else if (objectCid === undefined || cids.includes(objectCid))
            out.push(rows);
    }
    return out;
}

function inList(col, list) {
    const values = [...new Set(list.map(String))];
    return values.length ? [`${col} IN (${values.map(() => '?').join(',')})`, values] : ['0', []];
}

/** Условия строк (подразделения, места, автор) на таблицу с колонками unit/place/author. */
function rowParts(g, alias, entries) {
    const parts = [];
    if (g.units)
        parts.push(inList(`${alias}.unit`, g.units));
    if (g.places)
        parts.push(g.places.length
            ? [`(${g.places.map(() => `(${alias}.unit = ? AND ${alias}.place = ?)`).join(' OR ')})`, g.places.flat().map(String)]
            : ['0', []]);
    if (g.author !== undefined) {
        // проводку «свою» делает и своя операция, и своё действие (регистрация, исправление)
        parts.push(entries
            ? [`(${alias}.author = ? OR EXISTS (SELECT 1 FROM objects x WHERE x.id = ${alias}.op_id AND x.author = ?))`, [g.author, g.author]]
            : [`${alias}.author = ?`, [g.author]]);
    }
    return parts;
}

function anyOf(grants, partsOf) {
    if (grants == null)
        return null;
    const ors = [], args = [];
    for (const g of grants) {
        const parts = partsOf(g);
        if (!parts.length)
            return null;
        ors.push(parts.map(p => p[0]).join(' AND '));
        args.push(...parts.flatMap(p => p[1]));
    }
    return ors.length ? [`(${ors.map(s => `(${s})`).join(' OR ')})`, args] : ['0', []];
}

/** Условие видимости объектов (алиас таблицы `o`): [sql, args] или null — без ограничений. */
export function objectCond(grants, alias = 'o') {
    return anyOf(grants, g => [...(g.cids ? [inList(`${alias}.cid`, g.cids)] : []), ...rowParts(g, alias, false)]);
}

/**
 * Условие видимости проводок (алиас `e`, права из `entryGrants`): счета ветки проверяются
 * по колонкам `accCols` — стороне отчёта или обеим сторонам в журнале.
 */
export function entryCond(grants, accCols = ['e.debit_cid', 'e.credit_cid']) {
    return anyOf(grants, g => {
        const parts = [];
        if (g.accounts) {
            const c = accCols.map(col => inList(col, g.accounts));
            parts.push([`(${c.map(x => x[0]).join(' OR ')})`, c.flatMap(x => x[1])]);
        }
        if (g.ops)
            parts.push(inList('e.op_cid', g.ops));
        return [...parts, ...rowParts(g, 'e', true)];
    });
}

/** Подразделения, данные которых видны по правам (фильтр `units` формы): null — все. */
export function visibleUnits(grants) {
    if (grants == null)
        return null;
    const set = new Set();
    for (const g of grants) {
        for (const u of g.units ?? [])
            set.add(u);
        for (const [u] of g.places ?? [])
            set.add(u);
    }
    return [...set];
}

/**
 * Подразделения и места, от имени которых пользователь пишет в класс: ссылки на запись
 * на класс или его предка. ADMIN подразделения — любое его место (`any`).
 * @returns {Array<{ unit, unit_label, place, place_label, any? }>}
 */
export function writeContexts(db, cls, links) {
    const out = new Map();
    const add = (l, place, any = false) => {
        const unit = unitOf(db, l.structure);
        const key = `${unit}\n${place ?? ''}`;
        const cur = out.get(key);
        if (cur) {
            cur.any ||= any;
            return;
        }
        out.set(key, {
            unit,
            unit_label: getClass(db, unit)?.label ?? unit,
            place,
            place_label: place ? l.labels?.[place] ?? place : null,
            ...(any ? { any } : {}),
        });
    };
    for (const l of links || []) {
        if ((l.access !== 'write' && l.access !== 'admin') || !under(cls.path, l.id))
            continue;
        if (l.relation === 'admin')
            add(l, null, true);
        else if (l.relation !== 'member')
            continue;
        else if (l.place)
            add(l, l.place);
        else if (l.places?.length)
            l.places.forEach(p => add(l, p));
        else
            add(l, null);
    }
    return [...out.values()].sort((a, b) => a.unit_label.localeCompare(b.unit_label, 'ru')
        || String(a.place_label ?? '').localeCompare(String(b.place_label ?? ''), 'ru'));
}

const ctxTitle = c => (c.place ? `${c.unit_label} / ${c.place_label}` : c.unit_label);

/**
 * Подразделение и место записи объекта. Не указаны — единственные доступные; доступных
 * несколько — ошибка с их списком. Указанные проверяются по местам записи пользователя.
 * @param {Array} contexts writeContexts
 * @param {object} want { unit?, place? } — что передал клиент
 * @param {object} [opts] { full — запись без ссылок (назначение класса, системная сессия):
 *   любое подразделение; known — пути мест указанного подразделения (проверка `place`) }
 * @returns {{ unit: string|null, place: string|null }}
 */
export function resolvePlace(db, contexts, { unit, place } = {}, { full = false, known = null } = {}) {
    const pl = isEmpty(place) ? null : String(place);
    if (isEmpty(unit)) {
        if (pl)
            throw new DataError('место (place) указывается вместе с подразделением (unit)');
        if (contexts.length === 1)
            return { unit: contexts[0].unit, place: contexts[0].place };
        if (full)
            return { unit: null, place: null };
        throw new DataError(contexts.length
            ? `укажите подразделение и место записи: ${contexts.map(ctxTitle).join('; ')}`
            : 'нет места, от которого можно записать в этот класс');
    }
    const c = getClass(db, unit);
    if (!c || FAMILY[c.type] !== 'structure')
        throw new DataError(`подразделение ${unit} не найдено`);
    if (pl && !(known || []).includes(pl))
        throw new DataError(`место ${pl} не найдено в «${c.label}»`);
    const mine = contexts.filter(x => x.unit === c.cid);
    if (!mine.length) {
        if (full)
            return { unit: c.cid, place: pl };
        throw new DataError(`нет права записи от подразделения «${c.label}»`);
    }
    if (pl) {
        if (full || mine.some(x => x.any || x.place === pl))
            return { unit: c.cid, place: pl };
        throw new DataError(`нет права записи от места «${pl}» подразделения «${c.label}»`);
    }
    if (mine.length === 1)
        return { unit: c.cid, place: mine[0].place };
    if (full || mine.some(x => x.any))
        return { unit: c.cid, place: null };
    throw new DataError(`укажите место записи в «${c.label}»: ${mine.map(ctxTitle).join('; ')}`);
}
