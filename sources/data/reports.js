/**
 * Отчёты единого журнала: журнал проводок, оборотно-сальдовая ведомость,
 * карточка счёта, состояние и траектория аналитического объекта, состав
 * виртуального справочника на дату.
 *
 * Отчёты строятся только по проводкам (docs/architecture-v2.md, Р10): у черновика
 * проводок нет, у отменённой операции проводки и сторно взаимно гасятся.
 * Итог по счёту включает все его субсчета (потомки в class_tree).
 *
 * Суммы — в рублях (в БД — копейки); сальдо делится на дебетовое и кредитовое,
 * количества — со знаком (Дт − Кт) в базовой единице.
 * Период — [from, to): граница-день в `to` включает весь день. Момент `at`
 * («состояние на») включителен; день 'ГГГГ-ММ-ДД' — на конец дня.
 * Общие фильтры проводок: `units` (список подразделений) или `unit`
 * (подразделение с вложенными), `op_cid` (класс операций с потомками), `op`, `author`, `place`;
 * `visible` — права видимости (scope.js, `entryGrants`): у ведомости, карточки и объекта ветка-счета
 * проверяется по счёту своей стороны, у журнала — по любой стороне.
 * Названия объектов и классов — в `names` ответа (текущие).
 */
import { getClass, descendants, ancestors, classesOfType } from './classes.js';
import { classSchema, analyticSlots, objectTitle, FAMILY } from './schema.js';
import { readObject, queryObjects, linkCids } from './objects.js';
import { presentEntry } from './posting.js';
import { round } from './expr.js';
import { DataError } from './errors.js';
import { parseTime, periodRange, dayStart, nextDay, localDay } from './time.js';
import { entryCond } from './scope.js';

const isEmpty = v => v === undefined || v === null || v === '';
const LOW = -8.64e15, HIGH = 8.64e15;
const lo = x => (Number.isFinite(x) ? x : LOW);
const hi = x => (Number.isFinite(x) ? x : HIGH);
const rub = k => k / 100;
const q6 = v => round(v, 6);
const CHUNK = 500;

/** Стороны проводки: [сторона, колонка счёта, корр. колонка, знак суммы]. */
const SIDES = [['D', 'debit_cid', 'credit_cid', ''], ['C', 'credit_cid', 'debit_cid', '-']];

function inCond(col, list) {
    const values = [...new Set([].concat(list).map(String))];
    return values.length ? [`${col} IN (${values.map(() => '?').join(',')})`, values] : ['0', []];
}

/** Исключающая верхняя граница момента «на»: день — до конца дня, момент — включительно. */
function atBound(at) {
    if (isEmpty(at))
        return HIGH;
    const s = String(at).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s))
        return nextDay(dayStart(s));
    return parseTime(at, 'момент') + 1;
}

function page(q, def, max) {
    return {
        limit: Math.max(1, Math.min(max, Number(q.limit) || def)),
        offset: Math.max(0, Number(q.offset) || 0),
    };
}

function mustClass(db, ref, family, what) {
    const c = getClass(db, ref);
    if (!c || FAMILY[c.type] !== family)
        throw new DataError(`${what} ${ref} не найден`);
    return c;
}

/** Общие условия на проводки (алиас таблицы — e): видимость, класс операций, операция, автор, место. */
function entryConds(db, q) {
    const c = [];
    if (Array.isArray(q.units))
        c.push(inCond('e.unit', q.units));
    if (!isEmpty(q.unit))
        c.push(inCond('e.unit', descendants(db, mustClass(db, q.unit, 'structure', 'подразделение').cid)));
    if (!isEmpty(q.op_cid))
        c.push(inCond('e.op_cid', descendants(db, mustClass(db, q.op_cid, 'operation', 'класс операций').cid)));
    if (!isEmpty(q.op))
        c.push(['e.op_id = ?', [String(q.op)]]);
    if (!isEmpty(q.author))
        c.push(['e.author = ?', [String(q.author)]]);
    if (!isEmpty(q.place))
        c.push(['e.place = ?', [String(q.place)]]);
    return c;
}

/**
 * Строки сторон проводок: проводка даёт строку дебета (сумма со знаком +) и кредита (−).
 * Колонки: side, id, time, op_id, op_cid, rule, row, storno, acc, corr, amt, q, q2,
 * slot (слот объекта при `object`), k0..kN (аналитики стороны по слотам `by`).
 * @param {object} p { accounts?: cid[], by?: слоты, analytics?: { слот: id }, object?: id, conds?: [sql, args][],
 *                     visible?: права видимости — ветка-счета по счёту стороны }
 */
function sideRows({ accounts = null, by = [], analytics = null, object = null, conds = [], visible = null }) {
    const parts = [], args = [];
    for (const [side, col, other, sign] of SIDES) {
        let sql = `SELECT '${side}' side, e.id, e.time, e.op_id, e.op_cid, e.rule, e.row, e.storno,
            e.${col} acc, e.${other} corr, ${sign}e.amount amt, ${sign}e.qty q, ${sign}e.qty2 q2,
            ${object ? 'o.slot' : 'NULL'} slot${by.map((_, i) => `, k${i}.ref_id k${i}`).join('')}
            FROM entries e`;
        if (object) {
            sql += ` JOIN entry_analytics o ON o.entry_id = e.id AND o.side = '${side}' AND o.ref_id = ?`;
            args.push(String(object));
        }
        by.forEach((slot, i) => {
            sql += ` LEFT JOIN entry_analytics k${i} ON k${i}.entry_id = e.id AND k${i}.side = '${side}' AND k${i}.slot = ?`;
            args.push(slot);
        });
        const where = [];
        const add = ([s, a]) => {
            where.push(s);
            args.push(...a);
        };
        if (accounts)
            add(inCond(`e.${col}`, accounts));
        for (const [slot, ref] of Object.entries(analytics || {})) {
            if (Array.isArray(ref)) {
                if (!ref.length)
                    add(['0', []]);
                else
                    add([`EXISTS (SELECT 1 FROM entry_analytics f WHERE f.entry_id = e.id AND f.side = '${side}' AND f.slot = ? AND f.ref_id IN (${ref.map(() => '?').join(',')}))`,
                        [String(slot), ...ref.map(String)]]);
            }
            else if (!isEmpty(ref)) {
                add([`EXISTS (SELECT 1 FROM entry_analytics f WHERE f.entry_id = e.id AND f.side = '${side}' AND f.slot = ? AND f.ref_id = ?)`,
                    [String(slot), String(typeof ref === 'object' ? ref.id : ref)]]);
            }
        }
        conds.forEach(add);
        const vc = entryCond(visible, [`e.${col}`]);
        if (vc)
            add(vc);
        if (where.length)
            sql += ' WHERE ' + where.join(' AND ');
        parts.push(sql);
    }
    return { sql: parts.join(' UNION ALL '), args };
}

/** Аналитики проводок: id → { D: { слот: id }, C: {...} }. */
function analyticsMap(db, ids) {
    const map = new Map();
    const list = [...new Set(ids)];
    for (let i = 0; i < list.length; i += CHUNK) {
        const chunk = list.slice(i, i + CHUNK);
        for (const a of db.prepare(`SELECT entry_id, side, slot, ref_id FROM entry_analytics WHERE entry_id IN (${chunk.map(() => '?').join(',')})`).all(...chunk)) {
            if (!map.has(a.entry_id))
                map.set(a.entry_id, { D: {}, C: {} });
            map.get(a.entry_id)[a.side][a.slot] = a.ref_id;
        }
    }
    return id => map.get(id) ?? { D: {}, C: {} };
}

/** Названия для показа: объекты (текущий заголовок) и классы (label); пути классов — чтобы форма открыла класс. */
export function namesOf(db, ids, cids = []) {
    const objects = {}, classes = {}, paths = {};
    const list = [...new Set(ids)].filter(v => !isEmpty(v)).map(String);
    for (let i = 0; i < list.length; i += CHUNK) {
        const chunk = list.slice(i, i + CHUNK);
        for (const r of db.prepare(`SELECT id, cid, body FROM objects WHERE id IN (${chunk.map(() => '?').join(',')})`).all(...chunk))
            objects[r.id] = objectTitle(classSchema(db, r.cid), JSON.parse(r.body)) || r.id;
    }
    for (const cid of new Set(cids)) {
        if (isEmpty(cid))
            continue;
        const c = getClass(db, cid);
        classes[cid] = c?.label ?? cid;
        if (c)
            paths[cid] = c.path;
    }
    return { objects, classes, paths };
}

/** Сальдо из суммы (копейки, Дт − Кт) и количеств. */
function balance(a, q = 0, q2 = 0) {
    return { debit: rub(Math.max(a, 0)), credit: rub(Math.max(-a, 0)), qty: q6(q), qty2: q6(q2) };
}

function accountCids(db, ref) {
    return descendants(db, mustClass(db, ref, 'account', 'счёт').cid);
}

/**
 * Собрать определения слотов аналитик по списку счетов (слот → схема целевого справочника).
 */
function slotsOfAccounts(db, accCids) {
    const map = new Map();
    const list = accCids?.length ? accCids : classesOfType(db, '$account').map(c => c.cid);
    for (const cid of list) {
        const s = classSchema(db, cid);
        for (const f of analyticSlots(s || { fields: [] })) {
            if (!map.has(f.id) && f.target) {
                const targetSchema = classSchema(db, f.target);
                if (targetSchema)
                    map.set(f.id, targetSchema);
            }
        }
    }
    return map;
}

/**
 * Двухэтапный механизм аналитик (субаналитики):
 * 1) Если задан фильтр по полям справочника-аналитики (через `analytics: { 'слот.поле': знач }`,
 *    `analytics: { слот: { поле: знач } }` или `subanalytics: { слот: { поле: знач } }`),
 *    сначала отбираются id подходящих объектов из справочника и его расширения OVERLAY ($virtual).
 * 2) Возвращается словарь `{ слот: id | id[] }` для фильтрации проводок счёта.
 */
export function resolveAnalyticsFilter(db, accCids, analytics, subanalytics) {
    if (!analytics && !subanalytics)
        return null;
    const slotTargets = slotsOfAccounts(db, accCids);
    const direct = new Map();
    const subConds = new Map();
    const addSub = (slot, field, cond) => {
        if (isEmpty(cond))
            return;
        if (!subConds.has(slot))
            subConds.set(slot, {});
        subConds.get(slot)[field] = cond;
    };

    for (const [k, v] of Object.entries(analytics || {})) {
        if (isEmpty(v))
            continue;
        const dot = k.indexOf('.');
        if (dot > 0) {
            addSub(k.slice(0, dot), k.slice(dot + 1), v);
            continue;
        }
        if (Array.isArray(v)) {
            direct.set(k, v.map(x => String(typeof x === 'object' ? x.id : x)));
            continue;
        }
        if (typeof v === 'object' && !('id' in v)) {
            const w = v.where && typeof v.where === 'object' ? v.where : v;
            for (const [fk, fv] of Object.entries(w))
                addSub(k, fk, fv);
            continue;
        }
        direct.set(k, String(typeof v === 'object' ? v.id : v));
    }
    for (const [slot, condObj] of Object.entries(subanalytics || {})) {
        if (!condObj || typeof condObj !== 'object')
            continue;
        for (const [fk, fv] of Object.entries(condObj))
            addSub(slot, fk, fv);
    }

    const out = {};
    for (const [slot, val] of direct)
        out[slot] = val;

    for (const [slot, where] of subConds) {
        if (!Object.keys(where).length)
            continue;
        const target = slotTargets.get(slot);
        if (!target) {
            out[slot] = [];
            continue;
        }
        const overlayFieldIds = new Set((target.overlay || []).map(f => f.id));
        const regWhere = {}, overWhere = {};
        for (const [fk, fv] of Object.entries(where)) {
            if (target.type === '$virtual' && overlayFieldIds.has(fk))
                overWhere[fk] = fv;
            else
                regWhere[fk] = fv;
        }
        let ids = null;
        if (Object.keys(regWhere).length) {
            const regCid = target.type === '$virtual' ? target.source?.registry : target.cid;
            const found = regCid ? queryObjects(db, { cid: regCid, where: regWhere, limit: 500 }).items.map(o => o.id) : [];
            ids = new Set(found);
        }
        if (Object.keys(overWhere).length) {
            const exts = queryObjects(db, { cid: target.cid, where: overWhere, limit: 500 }).items
                .map(o => o.ext_of).filter(Boolean);
            ids = ids ? new Set(exts.filter(id => ids.has(id))) : new Set(exts);
        }
        if (direct.has(slot)) {
            const d = [].concat(direct.get(slot));
            ids = ids ? new Set(d.filter(id => ids.has(id))) : new Set(d);
        }
        out[slot] = ids ? [...ids] : [];
    }
    return Object.keys(out).length ? out : null;
}

/** Значение поля субаналитики (`поле` или `структура.поле` или поле OVERLAY) у объекта id. */
function readSubAnalyticValue(db, targetSchema, objId, fieldPath) {
    if (!objId)
        return null;
    const obj = readObject(db, objId);
    if (!obj)
        return null;
    if (targetSchema?.type === '$virtual' && (targetSchema.overlay || []).some(f => f.id === fieldPath)) {
        const extRow = db.prepare("SELECT body FROM objects WHERE cid = ? AND ext_of = ? AND status <> 'deleted' LIMIT 1").get(targetSchema.cid, objId);
        if (extRow) {
            const extBody = JSON.parse(extRow.body);
            if (extBody[fieldPath] !== undefined && extBody[fieldPath] !== null && extBody[fieldPath] !== '')
                return String(extBody[fieldPath]);
        }
    }
    let cur = obj.body;
    for (const part of fieldPath.split('.')) {
        if (!cur || typeof cur !== 'object')
            return null;
        cur = cur[part];
    }
    return cur === undefined || cur === null || cur === '' ? null : String(cur);
}

function rangeOfTimes(rows) {
    if (!rows?.length)
        return null;
    const days = [...new Set(rows.map(r => localDay(r.time)).filter(Boolean))].sort();
    return days.length ? { start: days[0], end: days[days.length - 1], days } : null;
}

/* ---------- журнал ---------- */

/**
 * Журнал проводок за период.
 * @param {object} [q]
 * @param {*} [q.from] Начало периода
 * @param {*} [q.to] Конец периода (день — включительно)
 * @param {string} [q.account] Счёт (с субсчетами) в дебете или кредите
 * @param {string} [q.debit] Счёт дебета (с субсчетами)
 * @param {string} [q.credit] Счёт кредита (с субсчетами)
 * @param {string} [q.object] Объект в аналитике любой стороны
 * @param {boolean} [q.effective] Только действующие проводки: без сторно и прежних версий проведения
 * @param {boolean} [q.desc] Новые сверху
 * @param {number} [q.limit=100]
 * @param {number} [q.offset=0]
 * @returns {{ total, sum: {amount, qty, qty2}, items: object[], names, range }}
 */
export function journal(db, q = {}) {
    const [from, to] = periodRange(q.from, q.to);
    const baseConds = entryConds(db, q);
    if (!isEmpty(q.account)) {
        const cids = accountCids(db, q.account);
        const [d, da] = inCond('e.debit_cid', cids), [c, ca] = inCond('e.credit_cid', cids);
        baseConds.push([`(${d} OR ${c})`, [...da, ...ca]]);
    }
    if (!isEmpty(q.debit))
        baseConds.push(inCond('e.debit_cid', accountCids(db, q.debit)));
    if (!isEmpty(q.credit))
        baseConds.push(inCond('e.credit_cid', accountCids(db, q.credit)));
    if (!isEmpty(q.object))
        baseConds.push(['EXISTS (SELECT 1 FROM entry_analytics f WHERE f.entry_id = e.id AND f.ref_id = ?)', [String(q.object)]]);
    if (q.effective)
        baseConds.push(['e.storno = 0 AND NOT EXISTS (SELECT 1 FROM entries x WHERE x.op_id = e.op_id AND x.op_version > e.op_version)', []]);
    const visible = entryCond(q.visible);
    if (visible)
        baseConds.push(visible);
    const baseWhere = baseConds.length ? 'WHERE ' + baseConds.map(c => c[0]).join(' AND ') : '';
    const baseArgs = baseConds.flatMap(c => c[1]);
    const range = rangeOfTimes(db.prepare(`SELECT DISTINCT e.time AS time FROM entries e ${baseWhere}`).all(...baseArgs));

    const conds = [...baseConds];
    if (from > -Infinity)
        conds.push(['e.time >= ?', [from]]);
    if (to < Infinity)
        conds.push(['e.time < ?', [to]]);
    const where = conds.length ? 'WHERE ' + conds.map(c => c[0]).join(' AND ') : '';
    const args = conds.flatMap(c => c[1]);
    const t = db.prepare(`SELECT count(*) n, coalesce(sum(e.amount), 0) a, coalesce(sum(e.qty), 0) q, coalesce(sum(e.qty2), 0) q2
        FROM entries e ${where}`).get(...args);
    const { limit, offset } = page(q, 100, 1000);
    const dir = q.desc ? 'DESC' : 'ASC';
    const rows = db.prepare(`SELECT e.* FROM entries e ${where} ORDER BY e.time ${dir}, e.id ${dir} LIMIT ? OFFSET ?`)
        .all(...args, limit, offset);
    const an = analyticsMap(db, rows.map(r => r.id));
    const items = rows.map(r => {
        const a = an(r.id);
        const ref = side => Object.fromEntries(Object.entries(side).map(([slot, id]) => [slot, { ref_id: id }]));
        return presentEntry({ ...r, analytics: { D: ref(a.D), C: ref(a.C) } });
    });
    return {
        total: t.n,
        sum: { amount: rub(t.a), qty: q6(t.q), qty2: q6(t.q2) },
        items,
        range,
        names: namesOf(db,
            items.flatMap(e => [e.op_id, ...Object.values(e.debit_analytics), ...Object.values(e.credit_analytics)]),
            items.flatMap(e => [e.debit, e.credit, e.op_cid])),
    };
}

/* ---------- оборотно-сальдовая ведомость ---------- */

const ZERO = Object.freeze({ od: 0, oc: 0, td: 0, tc: 0, cd: 0, cc: 0, qo: 0, qd: 0, qc: 0, wo: 0, wd: 0, wc: 0 });

/** Итог строки ведомости (копейки): сальдо развёрнуто на дебетовое и кредитовое. */
function cellTotals(r) {
    const close = r.oa + r.da - r.ca;
    return {
        od: Math.max(r.oa, 0), oc: Math.max(-r.oa, 0), td: r.da, tc: r.ca, cd: Math.max(close, 0), cc: Math.max(-close, 0),
        qo: r.oq, qd: r.dq, qc: r.cq, wo: r.oq2, wd: r.dq2, wc: r.cq2,
    };
}

function addTotals(t, x) {
    for (const k of Object.keys(ZERO))
        t[k] += x[k];
    return t;
}

const isZero = t => Object.keys(ZERO).every(k => Math.abs(t[k]) < 1e-9);

function presentTotals(t) {
    const qty = (o, d, c) => ({ opening: q6(o), debit: q6(d), credit: q6(c), closing: q6(o + d - c) });
    return {
        opening: { debit: rub(t.od), credit: rub(t.oc) },
        turnover: { debit: rub(t.td), credit: rub(t.tc) },
        closing: { debit: rub(t.cd), credit: rub(t.cc) },
        qty: qty(t.qo, t.qd, t.qc),
        qty2: qty(t.wo, t.wd, t.wc),
    };
}

const byPath = (a, b) => a.path.localeCompare(b.path, 'ru', { numeric: true });

/** Счета ведомости: все счета или счёт (журнал) с потомками; узлы с детьми. */
function accountTree(db, ref) {
    let list = classesOfType(db, '$account');
    if (!isEmpty(ref)) {
        const set = new Set(accountCids(db, ref));
        list = list.filter(c => set.has(c.cid));
    }
    const nodes = new Map(list.map(c => [c.cid, { cid: c.cid, label: c.label, path: c.path, parent: c.parent, children: [], details: [], own: null }]));
    for (const n of nodes.values())
        nodes.get(n.parent)?.children.push(n);
    return nodes;
}

/**
 * Оборотно-сальдовая ведомость за период: сальдо на начало, обороты, сальдо на конец
 * по счетам и их субсчетам (итог счёта — сумма субсчетов, сальдо развёрнутое).
 * @param {object} [q]
 * @param {*} [q.from] Начало периода
 * @param {*} [q.to] Конец периода (день — включительно)
 * @param {string} [q.account] Только этот счёт (или журнал) с субсчетами
 * @param {string|string[]} [q.by] Слоты аналитик для разворота строк счёта (например 'counterparty')
 * @returns {{ rows: object[], total: object, names }}
 *   строка: { account, label, level, parent, leaf, key?: { слот: id }, opening, turnover, closing, qty, qty2 }
 */
export function trialBalance(db, q = {}) {
    const [from, to] = periodRange(q.from, q.to);
    const by = [].concat(q.by ?? []).filter(s => !isEmpty(s)).map(String);
    const baseSlots = by.map(s => s.split('.')[0]);
    const nodes = accountTree(db, q.account);
    const accList = isEmpty(q.account) ? null : [...nodes.keys()];
    const slotTargets = slotsOfAccounts(db, accList);
    const resolvedAnalytics = resolveAnalyticsFilter(db, accList, q.analytics, q.subanalytics);
    const baseConds = entryConds(db, q);
    const baseSide = sideRows({ accounts: accList, analytics: resolvedAnalytics, conds: baseConds, visible: q.visible });
    const range = rangeOfTimes(db.prepare(`SELECT DISTINCT time FROM (${baseSide.sql})`).all(...baseSide.args));
    const conds = [...baseConds, ['e.time < ?', [hi(to)]]];
    const { sql, args } = sideRows({ accounts: accList, by: baseSlots, analytics: resolvedAnalytics, conds, visible: q.visible });
    const keys = baseSlots.map((_, i) => `k${i}`);
    const F = lo(from);
    const sums = (col, cond) => `coalesce(sum(CASE WHEN ${cond} THEN ${col} END), 0)`;
    const open = 'time < ?', debit = "time >= ? AND side = 'D'", credit = "time >= ? AND side = 'C'";
    const rows = db.prepare(`SELECT acc${keys.map(k => ', ' + k).join('')},
        ${sums('amt', open)} oa, ${sums('q', open)} oq, ${sums('q2', open)} oq2,
        ${sums('amt', debit)} da, ${sums('q', debit)} dq, ${sums('q2', debit)} dq2,
        -${sums('amt', credit)} ca, -${sums('q', credit)} cq, -${sums('q2', credit)} cq2
        FROM (${sql}) GROUP BY acc${keys.map(k => ', ' + k).join('')}`)
        .all(...Array(9).fill(F), ...args);

    for (const r of rows) {
        let node = nodes.get(r.acc);
        if (!node) {
            node = { cid: r.acc, label: r.acc, path: r.acc, parent: null, children: [], details: [], own: null, orphan: true };
            nodes.set(r.acc, node);
        }
        const key = by.length ? Object.fromEntries(by.map((spec, i) => {
            const rawId = r[`k${i}`] ?? null;
            const dot = spec.indexOf('.');
            if (dot < 0 || !rawId)
                return [spec, rawId];
            const slot = spec.slice(0, dot), subField = spec.slice(dot + 1);
            return [spec, readSubAnalyticValue(db, slotTargets.get(slot), rawId, subField)];
        })) : null;
        if (key) {
            const sig = JSON.stringify(key);
            const existing = node.details.find(d => d._sig === sig);
            if (existing) {
                for (const k of ['oa', 'oq', 'oq2', 'da', 'dq', 'dq2', 'ca', 'cq', 'cq2'])
                    existing._raw[k] += r[k];
                existing.totals = cellTotals(existing._raw);
                continue;
            }
            const rawCopy = { oa: r.oa, oq: r.oq, oq2: r.oq2, da: r.da, dq: r.dq, dq2: r.dq2, ca: r.ca, cq: r.cq, cq2: r.cq2 };
            node.details.push({ key, _sig: sig, _raw: rawCopy, totals: cellTotals(rawCopy) });
        }
        else {
            node.details.push({ key: null, totals: cellTotals(r) });
        }
    }
    const keyIds = [];
    for (const n of nodes.values()) {
        n.keyed = by.length > 0 && n.details.some(d => Object.values(d.key).some(v => v !== null));
        if (!n.keyed && n.details.length) {
            const r = { oa: 0, oq: 0, oq2: 0, da: 0, dq: 0, dq2: 0, ca: 0, cq: 0, cq2: 0 };
            for (const d of n.details) {
                const t = d.totals;
                r.oa += t.od - t.oc; r.da += t.td; r.ca += t.tc;
                r.oq += t.qo; r.dq += t.qd; r.cq += t.qc;
                r.oq2 += t.wo; r.dq2 += t.wd; r.cq2 += t.wc;
            }
            n.own = cellTotals(r);
            n.details = [];
        }
        else if (n.keyed)
            keyIds.push(...n.details.flatMap(d => Object.values(d.key)));
    }
    const names = namesOf(db, keyIds, [...nodes.keys()]);
    const title = key => Object.values(key).map(id => (id === null ? '' : names.objects[id] ?? id)).join(' / ');

    const out = [];
    const walk = (n, level) => {
        const t = { ...ZERO };
        if (n.own)
            addTotals(t, n.own);
        for (const d of n.details)
            addTotals(t, d.totals);
        const children = [...n.children].sort(byPath).map(c => walk(c, level + 1));
        for (const c of children)
            addTotals(t, c.t);
        const ownSlots = analyticSlots(classSchema(db, n.cid) || { fields: [] });
        const hasAnalytics = ownSlots.length > 0 || children.some(c => c.hasAnalytics);
        return { n, level, t, children, hasAnalytics };
    };
    const emit = ({ n, level, t, children, hasAnalytics }) => {
        if (isZero(t))
            return;
        out.push({ account: n.cid, label: n.label, level, parent: nodes.has(n.parent) ? n.parent : null, leaf: !n.children.length, hasAnalytics: !!hasAnalytics, ...presentTotals(t) });
        for (const d of [...n.details].sort((a, b) => title(a.key).localeCompare(title(b.key), 'ru'))) {
            if (!isZero(d.totals))
                out.push({ account: n.cid, label: n.label, level: level + 1, parent: n.cid, leaf: true, key: d.key, hasAnalytics: true, ...presentTotals(d.totals) });
        }
        children.forEach(emit);
    };
    const roots = [...nodes.values()].filter(n => !nodes.has(n.parent)).sort(byPath).map(n => walk(n, 0));
    const total = { ...ZERO };
    for (const r of roots) {
        addTotals(total, r.t);
        emit(r);
    }
    return { rows: out, total: presentTotals(total), range, names };
}

/* ---------- карточка счёта ---------- */

function sideItem(r, an, opening) {
    const a = an(r.id);
    const own = r.side === 'D' ? a.D : a.C, corr = r.side === 'D' ? a.C : a.D;
    return {
        entry: r.id,
        time: r.time,
        op_id: r.op_id,
        op_cid: r.op_cid,
        rule: r.rule,
        row: r.row,
        storno: !!r.storno,
        account: r.acc,
        ...(r.slot ? { slot: r.slot } : {}),
        side: r.side === 'D' ? 'debit' : 'credit',
        corr: r.corr,
        debit: r.side === 'D' ? rub(r.amt) : 0,
        credit: r.side === 'C' ? rub(-r.amt) : 0,
        qty: q6(r.q),
        qty2: q6(r.q2),
        analytics: own,
        corr_analytics: corr,
        balance: rub(opening.a + r.ba),
        balance_qty: q6(opening.q + r.bq),
        balance_qty2: q6(opening.q2 + r.bq2),
    };
}

function itemNames(db, items, extra = [], extraCids = []) {
    return namesOf(db,
        [...extra, ...items.flatMap(i => [i.op_id, ...Object.values(i.analytics), ...Object.values(i.corr_analytics)])],
        [...extraCids, ...items.flatMap(i => [i.account, i.corr, i.op_cid])]);
}

/**
 * Карточка счёта: сальдо на начало, проводки периода со стороной, корр. счётом
 * и сальдо после каждой, обороты и сальдо на конец.
 * @param {object} q
 * @param {string} q.account Счёт (с субсчетами)
 * @param {object} [q.analytics] Отбор по аналитикам стороны счёта: { слот: id }
 * @param {*} [q.from] Начало периода
 * @param {*} [q.to] Конец периода (день — включительно)
 * @param {number} [q.limit=500]
 * @param {number} [q.offset=0]
 */
export function accountCard(db, q = {}) {
    if (isEmpty(q.account))
        throw new DataError('карточка счёта: не задан счёт');
    const cls = mustClass(db, q.account, 'account', 'счёт');
    const [from, to] = periodRange(q.from, q.to);
    const baseConds = entryConds(db, q);
    const accs = descendants(db, cls.cid);
    const resolvedAnalytics = resolveAnalyticsFilter(db, accs, q.analytics, q.subanalytics);
    const baseSide = sideRows({ accounts: accs, analytics: resolvedAnalytics, conds: baseConds, visible: q.visible });
    const range = rangeOfTimes(db.prepare(`SELECT DISTINCT time FROM (${baseSide.sql})`).all(...baseSide.args));
    const conds = [...baseConds, ['e.time < ?', [hi(to)]]];
    const { sql, args } = sideRows({ accounts: accs, analytics: resolvedAnalytics, conds, visible: q.visible });
    const F = lo(from);
    const o = db.prepare(`SELECT coalesce(sum(amt), 0) a, coalesce(sum(q), 0) q, coalesce(sum(q2), 0) q2 FROM (${sql}) WHERE time < ?`)
        .get(...args, F);
    const t = db.prepare(`SELECT count(*) n,
        coalesce(sum(CASE WHEN side = 'D' THEN amt END), 0) da, -coalesce(sum(CASE WHEN side = 'C' THEN amt END), 0) ca,
        coalesce(sum(CASE WHEN side = 'D' THEN q END), 0) dq, -coalesce(sum(CASE WHEN side = 'C' THEN q END), 0) cq,
        coalesce(sum(CASE WHEN side = 'D' THEN q2 END), 0) dq2, -coalesce(sum(CASE WHEN side = 'C' THEN q2 END), 0) cq2
        FROM (${sql}) WHERE time >= ?`).get(...args, F);
    const { limit, offset } = page(q, 500, 5000);
    const rows = db.prepare(`SELECT *, sum(amt) OVER w ba, sum(q) OVER w bq, sum(q2) OVER w bq2 FROM (${sql}) WHERE time >= ?
        WINDOW w AS (ORDER BY time, id, side ROWS UNBOUNDED PRECEDING) ORDER BY time, id, side LIMIT ? OFFSET ?`)
        .all(...args, F, limit, offset);
    const an = analyticsMap(db, rows.map(r => r.id));
    const items = rows.map(r => sideItem(r, an, o));
    const extraIds = Object.values(resolvedAnalytics || {}).flat().filter(v => typeof v === 'string');
    return {
        account: cls.cid,
        label: cls.label,
        opening: balance(o.a, o.q, o.q2),
        turnover: { debit: rub(t.da), credit: rub(t.ca), qty_debit: q6(t.dq), qty_credit: q6(t.cq), qty2_debit: q6(t.dq2), qty2_credit: q6(t.cq2) },
        closing: balance(o.a + t.da - t.ca, o.q + t.dq - t.cq, o.q2 + t.dq2 - t.cq2),
        total: t.n,
        items,
        range,
        names: itemNames(db, items, extraIds),
    };
}

/* ---------- двухпанельные обороты счёта (Экран 3 ODANT) и сборная карточка проводки (Экран 4 ODANT) ---------- */

const MONTHS_RU = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

function groupBucketOf(item, groupBy, names) {
    const d = new Date(item.time);
    const y = d.getFullYear(), m = d.getMonth();
    switch (groupBy) {
        case 'day': {
            const key = localDay(item.time);
            return { key, label: d.toLocaleDateString('ru-RU') };
        }
        case 'week': {
            const day = d.getDay() || 7;
            const mon = new Date(y, m, d.getDate() - day + 1);
            const sun = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 6);
            const key = localDay(mon.getTime());
            return { key, label: `${mon.toLocaleDateString('ru-RU')} – ${sun.toLocaleDateString('ru-RU')}` };
        }
        case 'month': {
            const key = `${y}-${String(m + 1).padStart(2, '0')}`;
            return { key, label: `${MONTHS_RU[m]} ${y} г.` };
        }
        case 'quarter': {
            const q = Math.floor(m / 3) + 1;
            return { key: `${y}-Q${q}`, label: `${q} кв. ${y} г.` };
        }
        case 'year':
            return { key: String(y), label: `${y} г.` };
        case 'operation': {
            const key = item.op_cid || '';
            return { key, label: names?.classes?.[key] || key.split('/').pop() || 'Операция' };
        }
        case 'account': {
            const key = item.corr || '';
            const code = key.split('/').pop();
            const label = names?.classes?.[key];
            return { key, label: label && label !== code ? `${code} ${label}` : code };
        }
        case 'none':
            return { key: `${item.entry}:${item.side}`, label: `${d.toLocaleDateString('ru-RU')} · ${names?.objects?.[item.op_id] || names?.classes?.[item.op_cid] || item.op_id}` };
        case 'all':
        default:
            return { key: 'all', label: 'За весь период' };
    }
}

/**
 * Обороты счёта с группировкой (Экран 3 ODANT):
 * слева — сводная таблица по группам (`none|day|week|month|quarter|year|operation|account|all`) с нарастающим сальдо и оборотом (Дт − Кт);
 * справа — операции выбранной группы с корреспондирующим счётом и переходом к проводке и документу.
 */
export function accountTurnovers(db, q = {}) {
    const groupBy = String(q.groupBy || 'quarter').toLowerCase();
    const card = accountCard(db, { ...q, limit: q.limit || 2000 });
    const openNet = round(card.opening.debit - card.opening.credit, 2);
    const openQty = card.opening.qty;
    const buckets = new Map();

    const items = card.items.map(it => {
        const b = groupBucketOf(it, groupBy, card.names);
        let g = buckets.get(b.key);
        if (!g) {
            g = { key: b.key, label: b.label, debit: 0, credit: 0, qty_debit: 0, qty_credit: 0, count: 0 };
            buckets.set(b.key, g);
        }
        g.debit = round(g.debit + it.debit, 2);
        g.credit = round(g.credit + it.credit, 2);
        if (it.side === 'debit')
            g.qty_debit = q6(g.qty_debit + it.qty);
        else
            g.qty_credit = q6(g.qty_credit - it.qty);
        g.count++;
        return { ...it, groupKey: b.key };
    });

    let running = openNet;
    let runningQty = openQty;
    const groups = [];
    for (const g of buckets.values()) {
        const netTurnover = round(g.debit - g.credit, 2);
        const qtyTurnover = q6(g.qty_debit - g.qty_credit);
        running = round(running + netTurnover, 2);
        runningQty = q6(runningQty + qtyTurnover);
        groups.push({
            ...g,
            turnover: netTurnover,
            balance: running,
            balance_debit: Math.max(running, 0),
            balance_credit: Math.max(-running, 0),
            qty_turnover: qtyTurnover,
            qty_balance: runningQty,
        });
    }

    return {
        account: card.account,
        label: card.label,
        groupBy,
        opening: { ...card.opening, net: openNet },
        groups,
        closing: {
            ...card.closing,
            debit: card.turnover.debit,
            credit: card.turnover.credit,
            turnover: round(card.turnover.debit - card.turnover.credit, 2),
            net: round(card.closing.debit - card.closing.credit, 2),
            count: card.total,
        },
        total: card.total,
        items: q.group ? items.filter(i => i.groupKey === String(q.group)) : items,
        range: card.range,
        names: card.names,
    };
}

/**
 * Сборная карточка проводки (Экран 4 ODANT):
 * микро-отчёт по ключу `entry`, собираемый из двух явных записей классов счетов
 * в `account_entries` (запись счёта Дебета + запись счёта Кредита) и шапки операции.
 */
export function readEntry(db, entryId) {
    const id = Number(entryId);
    if (!Number.isFinite(id))
        throw new DataError(`проводка ${entryId ?? ''} не найдена`);
    const accRows = db.prepare('SELECT * FROM account_entries WHERE entry_id = ? ORDER BY side').all(id);
    if (!accRows.length)
        throw new DataError(`проводка ${entryId} не найдена`);
    const dRow = accRows.find(r => r.side === 'D') || accRows[0];
    const cRow = accRows.find(r => r.side === 'C') || accRows.at(-1);
    const dAnalytics = JSON.parse(dRow.analytics || '{}');
    const cAnalytics = JSON.parse(cRow.analytics || '{}');
    const op = readObject(db, dRow.op_id);
    const opSchema = classSchema(db, dRow.op_cid);
    const names = namesOf(db,
        [dRow.op_id, ...Object.values(dAnalytics), ...Object.values(cAnalytics)],
        [dRow.account_cid, cRow.account_cid, dRow.op_cid]);

    const buildSide = (row, anMap) => {
        const s = classSchema(db, row.account_cid);
        const slots = analyticSlots(s || { fields: [] });
        const list = slots.map(slot => {
            const valId = anMap[slot.id] || null;
            return {
                id: slot.id,
                label: slot.label || slot.id,
                target: slot.target,
                value: valId,
                title: valId ? (names.objects[valId] || valId) : '',
            };
        });
        return {
            account: row.account_cid,
            path: s?.path || row.account_cid,
            label: s?.label || row.account_cid,
            amount: rub(row.side === 'D' ? row.debit : row.credit),
            qty: q6(row.side === 'D' ? row.qty_in : row.qty_out),
            qty2: q6(row.qty2),
            doc_qty: row.doc_qty,
            doc_unit: row.doc_unit,
            analytics: list,
        };
    };

    return {
        entry: id,
        time: dRow.time,
        rule: dRow.rule,
        row: dRow.row,
        amount: rub(dRow.debit || cRow.credit),
        qty: q6(dRow.qty_in || cRow.qty_out),
        qty2: q6(dRow.qty2),
        doc_qty: dRow.doc_qty,
        doc_unit: dRow.doc_unit,
        storno: !!dRow.storno,
        author: dRow.author,
        place: dRow.place,
        unit: dRow.unit,
        operation: {
            id: dRow.op_id,
            cid: dRow.op_cid,
            path: opSchema?.path || dRow.op_cid,
            label: opSchema?.label || dRow.op_cid,
            title: op?.title || names.objects[dRow.op_id] || opSchema?.label || dRow.op_id,
            time: op?.time ?? dRow.time,
            status: op?.status ?? 'registered',
        },
        debit: buildSide(dRow, dAnalytics),
        credit: buildSide(cRow, cAnalytics),
        names,
    };
}

/* ---------- аналитический объект ---------- */

function mustObject(db, id) {
    const obj = isEmpty(id) ? null : readObject(db, id);
    if (!obj)
        throw new DataError(`объект ${id ?? ''} не найден`);
    return obj;
}

/** Сальдо объекта по счетам и слотам аналитики: [{ account, slot, a, q, q2 }]. */
function objectBalances(db, sql, args, cond, condArgs) {
    return db.prepare(`SELECT acc, slot, coalesce(sum(amt), 0) a, coalesce(sum(q), 0) q, coalesce(sum(q2), 0) q2
        FROM (${sql}) WHERE ${cond} GROUP BY acc, slot ORDER BY acc, slot`).all(...args, ...condArgs);
}

const presentBalances = list => list
    .filter(b => b.a || Math.abs(b.q) > 1e-9 || Math.abs(b.q2) > 1e-9)
    .map(b => ({ account: b.acc, slot: b.slot, ...balance(b.a, b.q, b.q2) }));

/**
 * Состояние объекта на момент: версия объекта и его сальдо по всем счетам,
 * где он аналитика (по счёту и слоту).
 * @param {object} q { id, at?, account?, ...общие фильтры }
 */
export function objectState(db, q = {}) {
    const cur = mustObject(db, q.id);
    const conds = entryConds(db, q);
    conds.push(['e.time < ?', [atBound(q.at)]]);
    const { sql, args } = sideRows({ object: cur.id, accounts: isEmpty(q.account) ? null : accountCids(db, q.account), conds, visible: q.visible });
    const balances = presentBalances(objectBalances(db, sql, args, '1', []));
    return {
        object: isEmpty(q.at) ? cur : readObject(db, cur.id, { at: atBound(q.at) - 1 }),
        balances,
        names: namesOf(db, [], balances.map(b => b.account)),
    };
}

/**
 * Траектория объекта за период: сальдо на начало, движения, где он аналитика
 * (сальдо по счёту и слоту после каждого), сальдо на конец и версии объекта за период.
 * @param {object} q { id, from?, to?, account?, limit=500, offset=0, ...общие фильтры }
 */
export function objectTrajectory(db, q = {}) {
    const cur = mustObject(db, q.id);
    const [from, to] = periodRange(q.from, q.to);
    const conds = entryConds(db, q);
    conds.push(['e.time < ?', [hi(to)]]);
    const { sql, args } = sideRows({ object: cur.id, accounts: isEmpty(q.account) ? null : accountCids(db, q.account), conds, visible: q.visible });
    const F = lo(from);
    const opening = objectBalances(db, sql, args, 'time < ?', [F]);
    const start = new Map(opening.map(b => [`${b.acc}\n${b.slot}`, b]));
    const total = db.prepare(`SELECT count(*) n FROM (${sql}) WHERE time >= ?`).get(...args, F).n;
    const { limit, offset } = page(q, 500, 5000);
    const rows = db.prepare(`SELECT *, sum(amt) OVER w ba, sum(q) OVER w bq, sum(q2) OVER w bq2 FROM (${sql}) WHERE time >= ?
        WINDOW w AS (PARTITION BY acc, slot ORDER BY time, id, side ROWS UNBOUNDED PRECEDING) ORDER BY time, id, side LIMIT ? OFFSET ?`)
        .all(...args, F, limit, offset);
    const an = analyticsMap(db, rows.map(r => r.id));
    const items = rows.map(r => sideItem(r, an, start.get(`${r.acc}\n${r.slot}`) ?? { a: 0, q: 0, q2: 0 }));
    const closing = presentBalances(objectBalances(db, sql, args, '1', []));
    const versions = db.prepare('SELECT version, valid_from, author, status, body FROM object_versions WHERE id = ? AND valid_from >= ? AND valid_from < ? ORDER BY version')
        .all(cur.id, F, hi(to)).map(v => ({ ...v, body: JSON.parse(v.body) }));
    const openList = presentBalances(opening);
    return {
        object: cur,
        opening: openList,
        items,
        closing,
        versions,
        total,
        names: itemNames(db, items, [cur.id], [...openList.map(b => b.account), ...closing.map(b => b.account)]),
    };
}

/* ---------- виртуальный справочник ---------- */

/** Источник виртуального справочника: реестр, счёт и слот аналитики (SOURCE в class.js). */
function virtualSource(db, ref) {
    const s = classSchema(db, ref);
    if (!s || s.type !== '$virtual')
        throw new DataError(`виртуальный справочник ${ref} не найден`);
    const src = s.source || {};
    if (isEmpty(src.registry) || isEmpty(src.account))
        throw new DataError(`${s.label}: в SOURCE не заданы реестр (registry) и счёт (account)`);
    const reg = getClass(db, src.registry);
    if (!reg)
        throw new DataError(`${s.label}: реестр ${src.registry} не найден`);
    const acc = mustClass(db, src.account, 'account', `${s.label}: счёт`);
    const regCids = descendants(db, reg.cid);
    let slot = isEmpty(src.slot) ? null : String(src.slot);
    if (!slot) {
        const fits = analyticSlots(classSchema(db, acc.cid)).filter(f => linkCids(db, f.target)?.some(c => regCids.includes(c)));
        if (fits.length !== 1)
            throw new DataError(`${s.label}: у счёта ${acc.label} ${fits.length ? 'несколько аналитик' : 'нет аналитики'} по реестру ${reg.label} — укажите SOURCE.slot`);
        slot = fits[0].id;
    }
    const mode = String(src.mode || 'balance').toLowerCase();
    return { schema: s, registry: reg, regCids, accounts: descendants(db, acc.cid), slot, mode };
}

/**
 * Состав виртуального справочника на момент:
 * - при `mode: 'balance'` (по умолчанию) — объекты реестра-источника с ненулевым сальдо счёта на дату;
 * - при `mode: 'turnover'` — все объекты реестра-источника, у которых на дату были движения (обороты) по счёту.
 * @param {object} q { cid, at?, mode?, ...общие фильтры }
 * @returns {{ cid, label, slot, mode, registry: { cid, path, label },
 *   items: Array<{ id, cid, title, body, balance, turnover?: object, ext: { id, version, body } | null }> }}
 */
export function virtualMembers(db, q = {}) {
    const { schema, registry, regCids, accounts, slot, mode: srcMode } = virtualSource(db, q.cid);
    const mode = String(q.mode || srcMode || 'balance').toLowerCase();
    const bound = atBound(q.at);
    const conds = entryConds(db, q);
    conds.push(['e.time < ?', [bound]]);
    const { sql, args } = sideRows({ accounts, by: [slot], conds, visible: q.visible });
    const having = mode === 'turnover'
        ? 'HAVING da <> 0 OR ca <> 0 OR abs(dq) > 1e-9 OR abs(cq) > 1e-9 OR sum(amt) <> 0 OR abs(sum(q)) > 1e-9 OR abs(sum(q2)) > 1e-9'
        : 'HAVING sum(amt) <> 0 OR abs(sum(q)) > 1e-9 OR abs(sum(q2)) > 1e-9';
    const rows = db.prepare(`SELECT k0 id, sum(amt) a, sum(q) q, sum(q2) q2,
        coalesce(sum(CASE WHEN side = 'D' THEN amt ELSE 0 END), 0) da,
        coalesce(sum(CASE WHEN side = 'C' THEN -amt ELSE 0 END), 0) ca,
        coalesce(sum(CASE WHEN side = 'D' THEN q ELSE 0 END), 0) dq,
        coalesce(sum(CASE WHEN side = 'C' THEN -q ELSE 0 END), 0) cq
        FROM (${sql}) WHERE k0 IS NOT NULL GROUP BY k0 ${having}`).all(...args);
    const at = bound === HIGH ? undefined : bound - 1;
    const ext = db.prepare(`SELECT id FROM objects WHERE cid = ? AND ext_of = ? AND status <> 'deleted'`);
    const vAncs = ancestors(db, schema.cid).filter(a => a.type === '$virtual');
    const items = [];
    for (const r of rows) {
        const obj = readObject(db, r.id, { at }) ?? readObject(db, r.id);
        if (!obj || !regCids.includes(obj.cid))
            continue;
        let mergedExtBody = null;
        let ownExtObj = null;
        for (const anc of vAncs) {
            const e = ext.get(anc.cid, obj.id);
            const eo = e ? readObject(db, e.id, { at }) ?? readObject(db, e.id) : null;
            if (eo) {
                mergedExtBody = { ...(mergedExtBody || {}), ...(eo.body || {}) };
                if (anc.cid === schema.cid)
                    ownExtObj = eo;
            }
        }
        items.push({
            id: obj.id,
            cid: obj.cid,
            title: obj.title,
            body: obj.body,
            balance: balance(r.a, r.q, r.q2),
            turnover: { debit: rub(r.da), credit: rub(r.ca), qty_debit: q6(r.dq), qty_credit: q6(r.cq) },
            ext: ownExtObj
                ? { id: ownExtObj.id, version: ownExtObj.version, body: mergedExtBody || ownExtObj.body }
                : (mergedExtBody ? { id: null, version: null, body: mergedExtBody } : null),
        });
    }
    items.sort((a, b) => a.title.localeCompare(b.title, 'ru'));
    return { cid: schema.cid, label: schema.label, slot, mode, registry: { cid: registry.cid, path: registry.path, label: registry.label }, items };
}

/** Быстрый подсчёт количества участников виртуального справочника без чтения JSON-тел объектов. */
export function countVirtualMembers(db, cid) {
    const { regCids, accounts, slot, mode: srcMode } = virtualSource(db, cid);
    if (!regCids.length || !accounts.length)
        return 0;
    const mode = String(srcMode || 'balance').toLowerCase();
    const { sql, args } = sideRows({ accounts, by: [slot], conds: [] });
    const having = mode === 'turnover'
        ? 'HAVING da <> 0 OR ca <> 0 OR abs(dq) > 1e-9 OR abs(cq) > 1e-9 OR sum(amt) <> 0 OR abs(sum(q)) > 1e-9 OR abs(sum(q2)) > 1e-9'
        : 'HAVING sum(amt) <> 0 OR abs(sum(q)) > 1e-9 OR abs(sum(q2)) > 1e-9';
    const r = db.prepare(`SELECT count(*) n FROM (
        SELECT k0 id,
            coalesce(sum(CASE WHEN side = 'D' THEN amt ELSE 0 END), 0) da,
            coalesce(sum(CASE WHEN side = 'C' THEN -amt ELSE 0 END), 0) ca,
            coalesce(sum(CASE WHEN side = 'D' THEN q ELSE 0 END), 0) dq,
            coalesce(sum(CASE WHEN side = 'C' THEN -q ELSE 0 END), 0) cq
        FROM (${sql}) WHERE k0 IS NOT NULL GROUP BY k0 ${having}
    ) g JOIN objects o ON o.id = g.id WHERE o.status <> 'deleted' AND o.cid IN (${regCids.map(() => '?').join(',')})`).get(...args, ...regCids);
    return Number(r?.n) || 0;
}

/** Объект — участник виртуального справочника на момент (`visible` — только по видимым проводкам). */
export function isVirtualMember(db, cid, id, at, visible = null, modeOverride = null) {
    const { regCids, accounts, slot, mode: srcMode } = virtualSource(db, cid);
    const mode = String(modeOverride || srcMode || 'balance').toLowerCase();
    const conds = [['e.time < ?', [atBound(at)]]];
    const { sql, args } = sideRows({ accounts, analytics: { [slot]: id }, conds, visible });
    const r = db.prepare(`SELECT coalesce(sum(amt), 0) a, coalesce(sum(q), 0) q, coalesce(sum(q2), 0) q2,
        coalesce(sum(CASE WHEN side = 'D' THEN amt ELSE 0 END), 0) da,
        coalesce(sum(CASE WHEN side = 'C' THEN -amt ELSE 0 END), 0) ca,
        coalesce(sum(CASE WHEN side = 'D' THEN q ELSE 0 END), 0) dq,
        coalesce(sum(CASE WHEN side = 'C' THEN -q ELSE 0 END), 0) cq
        FROM (${sql})`).get(...args);
    const obj = db.prepare('SELECT cid FROM objects WHERE id = ?').get(String(id));
    if (!obj || !regCids.includes(obj.cid))
        return false;
    if (mode === 'turnover')
        return r.da !== 0 || r.ca !== 0 || Math.abs(r.dq) > 1e-9 || Math.abs(r.cq) > 1e-9 || r.a !== 0 || Math.abs(r.q) > 1e-9 || Math.abs(r.q2) > 1e-9;
    return r.a !== 0 || Math.abs(r.q) > 1e-9 || Math.abs(r.q2) > 1e-9;
}
