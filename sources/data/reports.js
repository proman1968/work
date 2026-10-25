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
import { getClass, descendants, classesOfType } from './classes.js';
import { classSchema, analyticSlots, objectTitle, FAMILY } from './schema.js';
import { readObject, linkCids } from './objects.js';
import { presentEntry } from './posting.js';
import { round } from './expr.js';
import { DataError } from './errors.js';
import { parseTime, periodRange, dayStart, nextDay } from './time.js';
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
            if (!isEmpty(ref))
                add([`EXISTS (SELECT 1 FROM entry_analytics f WHERE f.entry_id = e.id AND f.side = '${side}' AND f.slot = ? AND f.ref_id = ?)`,
                    [String(slot), String(typeof ref === 'object' ? ref.id : ref)]]);
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
 * @returns {{ total, sum: {amount, qty, qty2}, items: object[], names }}
 */
export function journal(db, q = {}) {
    const [from, to] = periodRange(q.from, q.to);
    const conds = entryConds(db, q);
    if (from > -Infinity)
        conds.push(['e.time >= ?', [from]]);
    if (to < Infinity)
        conds.push(['e.time < ?', [to]]);
    if (!isEmpty(q.account)) {
        const cids = accountCids(db, q.account);
        const [d, da] = inCond('e.debit_cid', cids), [c, ca] = inCond('e.credit_cid', cids);
        conds.push([`(${d} OR ${c})`, [...da, ...ca]]);
    }
    if (!isEmpty(q.debit))
        conds.push(inCond('e.debit_cid', accountCids(db, q.debit)));
    if (!isEmpty(q.credit))
        conds.push(inCond('e.credit_cid', accountCids(db, q.credit)));
    if (!isEmpty(q.object))
        conds.push(['EXISTS (SELECT 1 FROM entry_analytics f WHERE f.entry_id = e.id AND f.ref_id = ?)', [String(q.object)]]);
    if (q.effective)
        conds.push(['e.storno = 0 AND NOT EXISTS (SELECT 1 FROM entries x WHERE x.op_id = e.op_id AND x.op_version > e.op_version)', []]);
    const visible = entryCond(q.visible);
    if (visible)
        conds.push(visible);
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
    const nodes = accountTree(db, q.account);
    const conds = entryConds(db, q);
    conds.push(['e.time < ?', [hi(to)]]);
    const { sql, args } = sideRows({ accounts: isEmpty(q.account) ? null : [...nodes.keys()], by, conds, visible: q.visible });
    const keys = by.map((_, i) => `k${i}`);
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
            // проводки по счёту, которого больше нет в дереве: итоги должны сходиться
            node = { cid: r.acc, label: r.acc, path: r.acc, parent: null, children: [], details: [], own: null, orphan: true };
            nodes.set(r.acc, node);
        }
        const key = by.length ? Object.fromEntries(by.map((slot, i) => [slot, r[`k${i}`] ?? null])) : null;
        node.details.push({ key, totals: cellTotals(r) });
    }
    const keyIds = [];
    for (const n of nodes.values()) {
        n.keyed = by.length > 0 && n.details.some(d => Object.values(d.key).some(v => v !== null));
        if (!n.keyed && n.details.length) {
            // без разворота: одно сальдо счёта (свёрнутое)
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
        return { n, level, t, children };
    };
    const emit = ({ n, level, t, children }) => {
        if (isZero(t))
            return;
        out.push({ account: n.cid, label: n.label, level, parent: nodes.has(n.parent) ? n.parent : null, leaf: !n.children.length, ...presentTotals(t) });
        for (const d of [...n.details].sort((a, b) => title(a.key).localeCompare(title(b.key), 'ru'))) {
            if (!isZero(d.totals))
                out.push({ account: n.cid, label: n.label, level: level + 1, parent: n.cid, leaf: true, key: d.key, ...presentTotals(d.totals) });
        }
        children.forEach(emit);
    };
    const roots = [...nodes.values()].filter(n => !nodes.has(n.parent)).sort(byPath).map(n => walk(n, 0));
    const total = { ...ZERO };
    for (const r of roots) {
        addTotals(total, r.t);
        emit(r);
    }
    return { rows: out, total: presentTotals(total), names };
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

function itemNames(db, items, extra = []) {
    return namesOf(db,
        [...extra, ...items.flatMap(i => [i.op_id, ...Object.values(i.analytics), ...Object.values(i.corr_analytics)])],
        items.flatMap(i => [i.account, i.corr, i.op_cid]));
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
    const conds = entryConds(db, q);
    conds.push(['e.time < ?', [hi(to)]]);
    const { sql, args } = sideRows({ accounts: descendants(db, cls.cid), analytics: q.analytics, conds, visible: q.visible });
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
    return {
        account: cls.cid,
        label: cls.label,
        opening: balance(o.a, o.q, o.q2),
        turnover: { debit: rub(t.da), credit: rub(t.ca), qty_debit: q6(t.dq), qty_credit: q6(t.cq), qty2_debit: q6(t.dq2), qty2_credit: q6(t.cq2) },
        closing: balance(o.a + t.da - t.ca, o.q + t.dq - t.cq, o.q2 + t.dq2 - t.cq2),
        total: t.n,
        items,
        names: itemNames(db, items, Object.values(q.analytics || {})),
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
        names: itemNames(db, items, [cur.id]),
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
    return { schema: s, registry: reg, regCids, accounts: descendants(db, acc.cid), slot };
}

/**
 * Состав виртуального справочника на момент: объекты реестра-источника с ненулевым
 * сальдо счёта-источника по слоту аналитики, их состояние на момент и запись-расширение.
 * @param {object} q { cid, at?, ...общие фильтры }
 * @returns {{ cid, label, slot, registry: { cid, path, label },
 *   items: Array<{ id, cid, title, body, balance, ext: { id, version, body } | null }> }}
 */
export function virtualMembers(db, q = {}) {
    const { schema, registry, regCids, accounts, slot } = virtualSource(db, q.cid);
    const bound = atBound(q.at);
    const conds = entryConds(db, q);
    conds.push(['e.time < ?', [bound]]);
    const { sql, args } = sideRows({ accounts, by: [slot], conds, visible: q.visible });
    const rows = db.prepare(`SELECT k0 id, sum(amt) a, sum(q) q, sum(q2) q2 FROM (${sql}) WHERE k0 IS NOT NULL
        GROUP BY k0 HAVING sum(amt) <> 0 OR abs(sum(q)) > 1e-9 OR abs(sum(q2)) > 1e-9`).all(...args);
    const at = bound === HIGH ? undefined : bound - 1;
    const ext = db.prepare(`SELECT id FROM objects WHERE cid = ? AND ext_of = ? AND status <> 'deleted'`);
    const items = [];
    for (const r of rows) {
        const obj = readObject(db, r.id, { at }) ?? readObject(db, r.id);
        if (!obj || !regCids.includes(obj.cid))
            continue;
        const e = ext.get(schema.cid, obj.id);
        const extObj = e ? readObject(db, e.id, { at }) ?? readObject(db, e.id) : null;
        items.push({
            id: obj.id,
            cid: obj.cid,
            title: obj.title,
            body: obj.body,
            balance: balance(r.a, r.q, r.q2),
            ext: extObj ? { id: extObj.id, version: extObj.version, body: extObj.body } : null,
        });
    }
    items.sort((a, b) => a.title.localeCompare(b.title, 'ru'));
    return { cid: schema.cid, label: schema.label, slot, registry: { cid: registry.cid, path: registry.path, label: registry.label }, items };
}

/** Объект — участник виртуального справочника на момент (`visible` — только по видимым проводкам). */
export function isVirtualMember(db, cid, id, at, visible = null) {
    const { regCids, accounts, slot } = virtualSource(db, cid);
    const conds = [['e.time < ?', [atBound(at)]]];
    const { sql, args } = sideRows({ accounts, analytics: { [slot]: id }, conds, visible });
    const r = db.prepare(`SELECT coalesce(sum(amt), 0) a, coalesce(sum(q), 0) q, coalesce(sum(q2), 0) q2 FROM (${sql})`).get(...args);
    const obj = db.prepare('SELECT cid FROM objects WHERE id = ?').get(String(id));
    return !!obj && regCids.includes(obj.cid) && (r.a !== 0 || Math.abs(r.q) > 1e-9 || Math.abs(r.q2) > 1e-9);
}
