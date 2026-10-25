/**
 * Проведение операций: проводки единого журнала по правилам класса.
 *
 * Правило (POSTINGS, собирается по наследованию в schema.js):
 *   { id, each?, when?, amount?, qty?, unit?, item?, qty2?,
 *     debit: { account, analytics: { слот: выражение } }, credit: { ... } }
 *   - each   — табличная часть: проводка на каждую строку (в выражениях `row`);
 *   - when   — условие: ложь — проводки нет;
 *   - amount — сумма в рублях (хранится в копейках);
 *   - qty    — количество в единице документа; с `unit` и `item` пересчитывается
 *              в базовую единицу номенклатуры (её `base_unit` и табличная часть
 *              `units`: { unit, coef }); в проводке — базовое, а также doc_qty/doc_unit;
 *   - qty2   — второе измерение (масса при учёте в литрах и т. п.);
 *   - аналитики счёта — выражения, дающие id объекта целевого класса слота.
 *   Строка, где сумма и количества нулевые, проводки не даёт.
 *
 * Функции выражений: norm(вид, объект?, поУмолчанию?) — норматив на дату
 * операции (остаток количества счёта нормативов, см. normValue);
 * coef(номенклатура, единица) — коэффициент единицы к базовой.
 *
 * Автоаналитики проводки — колонки: операция, её класс, автор действия,
 * рабочее место и подразделение операции.
 *
 * Жизненный цикл (docs/architecture-v2.md, Р1): регистрация — проводки в той же
 * транзакции; исправление — новая версия, сторно действующих проводок и новые
 * проводки; отмена — сторно. Дата в закрытом периоде: регистрировать и переносить
 * туда нельзя, а сторно и новые проводки исправления датируются текущим моментом.
 */
import { tx, getSetting, setSetting } from './db.js';
import { getClass, descendants, classesOfType, classesGeneration } from './classes.js';
import { classSchema, checkSchema, analyticSlots } from './schema.js';
import { compile, toNumber, round, ExprError } from './expr.js';
import { readObject, writeVersion, validateBody, linkCids, mergeBody } from './objects.js';
import { DataError } from './errors.js';
import { parseTime, localDay, dayStart, nextDay } from './time.js';

const isEmpty = v => v === undefined || v === null || v === '';
const num = v => toNumber(v, msg => { throw new DataError(msg); });

/* ---------- закрытый период ---------- */

const CLOSED_KEY = 'closed_until';

/** Последний закрытый день 'YYYY-MM-DD' (включительно) или null. */
export function closedUntil(db) {
    return getSetting(db, CLOSED_KEY) ?? null;
}

/** Момент попадает в закрытый период. */
export function isClosed(db, time) {
    const day = closedUntil(db);
    return !!day && time < nextDay(dayStart(day));
}

/**
 * Закрыть период по день включительно (null — открыть всё).
 * Закрыть можно только прошедший день: исправления в закрытом периоде датируются сегодняшним.
 */
export function closePeriod(db, day) {
    if (isEmpty(day)) {
        setSetting(db, CLOSED_KEY, null);
        return null;
    }
    const s = String(day).trim();
    if (nextDay(dayStart(s)) > Date.now())
        throw new DataError(`закрыть можно только прошедший день, а не ${s}`);
    setSetting(db, CLOSED_KEY, s);
    return s;
}

function closedError(db, what) {
    return new DataError(`период по ${closedUntil(db)} закрыт — ${what}`);
}

/* ---------- нормативы ---------- */

const normsCache = new WeakMap();

/**
 * Счёт нормативов: класс счёта с `NORMS: true` или `NORMS: { kind, object }` —
 * имена слотов-аналитик вида норматива и объекта (по умолчанию 'kind' и 'object').
 */
function normsAccount(db) {
    const gen = classesGeneration(db);
    const hit = normsCache.get(db);
    if (hit && hit.gen === gen)
        return hit.acc;
    const list = classesOfType(db, '$account').filter(c => c.own?.NORMS);
    let acc = null;
    if (list.length > 1)
        throw new DataError(`счетов нормативов несколько: ${list.map(c => c.path).join(', ')} — NORMS должен быть у одного`);
    if (list.length) {
        const c = list[0];
        const spec = typeof c.own.NORMS === 'object' ? c.own.NORMS : {};
        const kind = String(spec.kind || 'kind');
        const slot = analyticSlots(classSchema(db, c.cid)).find(f => f.id === kind);
        acc = {
            cid: c.cid,
            label: c.label,
            cids: descendants(db, c.cid),
            kind,
            object: String(spec.object || 'object'),
            kindCids: slot ? linkCids(db, slot.target) ?? [] : null,
        };
    }
    normsCache.set(db, { gen, acc });
    return acc;
}

function resolveKind(db, acc, kind) {
    const key = String(typeof kind === 'object' && kind ? kind.id : kind ?? '').trim();
    if (!key)
        throw new DataError('norm(): не задан вид норматива');
    if (!acc.kindCids)
        throw new DataError(`у счёта нормативов ${acc.label} нет аналитики «${acc.kind}»`);
    const marks = acc.kindCids.map(() => '?').join(',') || "''";
    const byId = db.prepare(`SELECT id FROM objects WHERE id = ? AND cid IN (${marks})`).get(key, ...acc.kindCids);
    if (byId)
        return byId.id;
    const byName = db.prepare(`SELECT id FROM objects WHERE cid IN (${marks}) AND status <> 'deleted'
        AND json_extract(body, '$.name') = ? ORDER BY created LIMIT 1`).get(...acc.kindCids, key);
    if (!byName)
        throw new DataError(`вид норматива «${key}» не найден`);
    return byName.id;
}

/**
 * Норматив на момент: остаток количества (Дт − Кт) счёта нормативов по виду и объекту.
 * С объектом — сначала его собственный норматив, затем общий (без объекта).
 * С `fallback` поиск только точный, а при отсутствии значения возвращается fallback
 * (так операция «Установка норматива» считает разницу: `value - norm(kind, object, 0)`).
 * @param {object} [opts] { fallback?, exclude? — id операции, чьи проводки не учитываются }
 */
export function normValue(db, kind, object, at, { fallback, exclude = '' } = {}) {
    const acc = normsAccount(db);
    if (!acc)
        throw new DataError('счёт нормативов не настроен (NORMS: true в class.js счёта)');
    const kindId = resolveKind(db, acc, kind);
    const moment = parseTime(at ?? Date.now(), 'дата норматива');
    const marks = acc.cids.map(() => '?').join(',');
    const lookup = obj => {
        let n = 0, v = 0;
        for (const [side, col] of [['D', 'debit_cid'], ['C', 'credit_cid']]) {
            const objCond = obj
                ? 'EXISTS (SELECT 1 FROM entry_analytics o WHERE o.entry_id = e.id AND o.side = ? AND o.slot = ? AND o.ref_id = ?)'
                : 'NOT EXISTS (SELECT 1 FROM entry_analytics o WHERE o.entry_id = e.id AND o.side = ? AND o.slot = ?)';
            const r = db.prepare(`SELECT coalesce(sum(CASE WHEN e.storno THEN -1 ELSE 1 END), 0) n, coalesce(sum(e.qty), 0) q
                FROM entries e JOIN entry_analytics k ON k.entry_id = e.id AND k.side = ? AND k.slot = ? AND k.ref_id = ?
                WHERE e.${col} IN (${marks}) AND e.time <= ? AND e.op_id <> ? AND ${objCond}`)
                .get(side, acc.kind, kindId, ...acc.cids, moment, String(exclude), side, acc.object, ...(obj ? [obj] : []));
            n += r.n;
            v += side === 'D' ? r.q : -r.q;
        }
        return n > 0 ? round(v, 10) : undefined;
    };
    const objId = isEmpty(object) ? null : String(typeof object === 'object' ? object.id : object);
    if (fallback !== undefined)
        return lookup(objId) ?? fallback;
    const v = (objId ? lookup(objId) : undefined) ?? lookup(null);
    if (v === undefined)
        throw new DataError(`норматив «${kind}» не задан на ${localDay(moment)}`);
    return v;
}

/* ---------- единицы ---------- */

/** Коэффициент единицы к базовой единице номенклатуры (версия объекта на момент). */
export function unitCoef(db, item, unit, at) {
    const u = String(unit ?? '').trim();
    if (!u)
        return 1;
    const id = String(typeof item === 'object' && item ? item.id : item ?? '');
    if (!id)
        throw new DataError(`единица «${u}» без номенклатуры`);
    const obj = readObject(db, id, { at }) ?? readObject(db, id);
    if (!obj)
        throw new DataError(`номенклатура ${id} не найдена`);
    const same = x => String(x ?? '').trim().toLowerCase() === u.toLowerCase();
    if (same(obj.body.base_unit))
        return 1;
    const row = (Array.isArray(obj.body.units) ? obj.body.units : []).find(r => same(r?.unit));
    if (!row)
        throw new DataError(`у «${obj.title || id}» нет единицы «${u}»`);
    const k = num(row.coef);
    if (!(k > 0))
        throw new DataError(`у «${obj.title || id}» коэффициент единицы «${u}» не положителен`);
    return k;
}

/* ---------- расчёт проводок ---------- */

const rulesCache = new WeakMap();

/** Правила класса операции готовы к проведению (checkSchema без ошибок; кэш до изменения классов). */
function assertRules(db, schema) {
    const gen = classesGeneration(db);
    let byDb = rulesCache.get(db);
    if (!byDb || byDb.gen !== gen) {
        byDb = { gen, map: new Map() };
        rulesCache.set(db, byDb);
    }
    if (!byDb.map.has(schema.cid))
        byDb.map.set(schema.cid, schema.leaf ? checkSchema(db, schema.cid) : [`${schema.path}: операции проводятся только в конечном классе`]);
    const errors = byDb.map.get(schema.cid);
    if (errors.length)
        throw new DataError(`${schema.label}: правила проводок не готовы`, errors.map(message => ({ message })));
}

function sideOf(db, rule, side, scope, fns) {
    const name = side === 'debit' ? 'дебет' : 'кредит';
    const cls = getClass(db, rule[side]?.account);
    if (!cls)
        throw new DataError(`счёт ${rule[side]?.account} (${name}) не найден`);
    const acc = classSchema(db, cls.cid);
    const analytics = {};
    for (const slot of analyticSlots(acc)) {
        const src = rule[side].analytics?.[slot.id];
        let v = isEmpty(src) ? undefined : compile(src).run(scope, fns);
        if (v && typeof v === 'object' && !Array.isArray(v))
            v = v.id;
        if (isEmpty(v)) {
            if (slot.required)
                throw new DataError(`аналитика «${slot.label}» счёта ${acc.label} (${name}) не заполнена`);
            continue;
        }
        if (Array.isArray(v))
            throw new DataError(`аналитика «${slot.label}» счёта ${acc.label} (${name}) — список, а не один объект`);
        const id = String(v);
        const obj = db.prepare('SELECT cid, status FROM objects WHERE id = ?').get(id);
        const cids = linkCids(db, slot.target);
        if (!obj || !cids?.includes(obj.cid) || obj.status === 'deleted')
            throw new DataError(`аналитика «${slot.label}» счёта ${acc.label} (${name}): объект ${id} не найден в ${getClass(db, slot.target)?.label ?? slot.target}`);
        analytics[slot.id] = { ref_id: id, ref_cid: obj.cid };
    }
    return { cid: cls.cid, analytics };
}

/**
 * Проводки операции по правилам класса (без записи).
 * @param {object} op { id, cid, time, body }
 * @returns {{ entries: object[], errors: Array<{field, message}> }} amount — в копейках
 */
function computeEntries(db, schema, op) {
    const entries = [], errors = [];
    const fns = {
        norm: (...a) => normValue(db, a[0], a[1], op.time, { exclude: op.id, ...(a.length >= 3 ? { fallback: a[2] } : {}) }),
        coef: (item, unit) => unitCoef(db, item, unit, op.time),
    };
    for (const rule of schema.postings) {
        const rows = rule.each ? (Array.isArray(op.body[rule.each]) ? op.body[rule.each] : []) : [null];
        rows.forEach((row, i) => {
            const where = rule.each ? `правило «${rule.id}», строка ${i + 1}` : `правило «${rule.id}»`;
            try {
                const scope = rule.each ? { ...op.body, row } : { ...op.body };
                const ev = key => (isEmpty(rule[key]) ? undefined : compile(rule[key]).run(scope, fns));
                if (!isEmpty(rule.when) && !ev('when'))
                    return;
                const amount = Math.round(round(num(ev('amount')), 2) * 100);
                const docQty = num(ev('qty'));
                const unit = isEmpty(rule.unit) ? '' : String(ev('unit') ?? '').trim();
                const qty = round(unit ? docQty * unitCoef(db, ev('item'), unit, op.time) : docQty, 6);
                const qty2 = round(num(ev('qty2')), 6);
                if (!amount && !qty && !qty2)
                    return;
                const debit = sideOf(db, rule, 'debit', scope, fns);
                const credit = sideOf(db, rule, 'credit', scope, fns);
                entries.push({
                    rule: rule.id,
                    row: rule.each ? i : -1,
                    debit_cid: debit.cid,
                    credit_cid: credit.cid,
                    amount,
                    qty,
                    qty2,
                    doc_qty: unit ? docQty : null,
                    doc_unit: unit || null,
                    analytics: { D: debit.analytics, C: credit.analytics },
                });
            }
            catch (e) {
                if (!(e instanceof DataError || e instanceof ExprError))
                    throw e;
                errors.push({ field: where, message: e.message });
            }
        });
    }
    return { entries, errors };
}

function insertEntries(db, op, entries, { time, version, author, storno = false, now }) {
    const ins = db.prepare(`INSERT INTO entries (op_id, op_version, op_cid, rule, row, time, debit_cid, credit_cid,
        amount, qty, qty2, doc_qty, doc_unit, author, place, unit, storno, created)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insA = db.prepare('INSERT INTO entry_analytics (entry_id, side, slot, ref_id, ref_cid) VALUES (?, ?, ?, ?, ?)');
    for (const e of entries) {
        const sign = storno ? -1 : 1;
        const res = ins.run(op.id, version, op.cid, e.rule, e.row, e.time ?? time, e.debit_cid, e.credit_cid,
            sign * e.amount, sign * e.qty, sign * e.qty2, e.doc_qty === null ? null : sign * e.doc_qty, e.doc_unit,
            author ?? op.author ?? null, op.place ?? null, op.unit ?? null, storno ? 1 : 0, now);
        const id = Number(res.lastInsertRowid);
        for (const side of ['D', 'C']) {
            for (const [slot, a] of Object.entries(e.analytics[side]))
                insA.run(id, side, slot, a.ref_id, a.ref_cid);
        }
    }
}

/** Действующие проводки операции: последней версии проведения, без сторно (amount в копейках). */
function effectiveRows(db, opId) {
    const rows = db.prepare(`SELECT * FROM entries WHERE op_id = ? AND storno = 0
        AND op_version = (SELECT max(op_version) FROM entries WHERE op_id = ?) ORDER BY id`).all(opId, opId);
    return rows.map(r => ({ ...r, analytics: analyticsOf(db, r.id) }));
}

function analyticsOf(db, entryId) {
    const out = { D: {}, C: {} };
    for (const a of db.prepare('SELECT side, slot, ref_id, ref_cid FROM entry_analytics WHERE entry_id = ?').all(entryId))
        out[a.side][a.slot] = { ref_id: a.ref_id, ref_cid: a.ref_cid };
    return out;
}

/** Сторно действующих проводок: дата прежняя, а в закрытом периоде — now. */
function stornoEntries(db, op, version, author, now) {
    const rows = effectiveRows(db, op.id).map(e => ({ ...e, time: isClosed(db, e.time) ? now : e.time }));
    insertEntries(db, op, rows, { version, author, storno: true, now });
    return rows.length;
}

/* ---------- жизненный цикл ---------- */

function mustOperation(db, id) {
    const op = readObject(db, id);
    if (!op)
        throw new DataError(`операция ${id} не найдена`);
    const schema = classSchema(db, op.cid);
    if (schema.family !== 'operation')
        throw new DataError(`«${op.title || id}» — не операция (${schema.label})`);
    return { op, schema };
}

const opName = op => `«${op.title || op.id}»`;

function postOrFail(db, schema, op) {
    const { entries, errors } = computeEntries(db, schema, op);
    if (errors.length)
        throw new DataError(`${opName(op)}: проводки не сформированы`, errors);
    return entries;
}

/**
 * Зарегистрировать черновик: проводки создаются в той же транзакции.
 * Повторная регистрация зарегистрированной операции ничего не меняет.
 * @param {object} p { id, author?, version? — ожидаемая версия }
 */
export function registerOperation(db, { id, author, version } = {}) {
    const { op, schema } = mustOperation(db, id);
    if (op.status === 'registered')
        return op;
    if (op.status !== 'draft')
        throw new DataError(`операция ${opName(op)} в статусе ${op.status} — регистрируется только черновик`);
    if (isClosed(db, op.time))
        throw closedError(db, `регистрировать операцию от ${localDay(op.time)} нельзя`);
    assertRules(db, schema);
    return tx(db, () => {
        const entries = postOrFail(db, schema, op);
        const next = writeVersion(db, op.id, { status: 'registered', author, version, system: true });
        insertEntries(db, next, entries, { time: next.time, version: next.version, author, now: Date.now() });
        return next;
    });
}

/**
 * Исправить зарегистрированную операцию: новая версия, сторно прежних проводок
 * и новые проводки — одной транзакцией. Без изменений — ничего не происходит.
 * @param {object} p { id, body — изменяемые поля (null — очистить), replace?, time?, author?, version? }
 */
export function correctOperation(db, p = {}) {
    const { op, schema } = mustOperation(db, p.id);
    if (op.status === 'draft')
        throw new DataError(`операция ${opName(op)} — черновик: её правят обычным изменением`);
    if (op.status !== 'registered')
        throw new DataError(`операция ${opName(op)} в статусе ${op.status} — исправляется только зарегистрированная`);
    const time = isEmpty(p.time) ? op.time : parseTime(p.time, 'дата операции');
    if (time !== op.time && isClosed(db, time))
        throw closedError(db, `перенести операцию на ${localDay(time)} нельзя`);
    assertRules(db, schema);
    return tx(db, () => {
        const next = writeVersion(db, op.id, { body: mergeBody(op.body, p), time, author: p.author, version: p.version, system: true });
        if (next.version === op.version)
            return op;
        const now = Date.now();
        const entries = postOrFail(db, schema, next);
        stornoEntries(db, next, next.version, p.author, now);
        insertEntries(db, next, entries, { time: isClosed(db, next.time) ? now : next.time, version: next.version, author: p.author, now });
        return next;
    });
}

/**
 * Отменить зарегистрированную операцию: сторно всех действующих проводок.
 * @param {object} p { id, author?, version? }
 */
export function cancelOperation(db, { id, author, version } = {}) {
    const { op } = mustOperation(db, id);
    if (op.status === 'cancelled')
        return op;
    if (op.status !== 'registered')
        throw new DataError(`операция ${opName(op)} в статусе ${op.status} — отменяется только зарегистрированная (черновик удаляют)`);
    return tx(db, () => {
        const next = writeVersion(db, op.id, { status: 'cancelled', author, version, system: true });
        stornoEntries(db, next, next.version, author, Date.now());
        return next;
    });
}

/**
 * Проводки, которые дала бы операция, без записи: существующая (`id`) или
 * несохранённая (`cid`, `body`, `time`). Для формы и ИИ: показать результат до регистрации.
 * @returns {{ entries: object[], errors: Array<{field, message}> }} amount — в рублях
 */
export function previewEntries(db, p = {}) {
    let op, schema;
    if (!isEmpty(p.id))
        ({ op, schema } = mustOperation(db, p.id));
    else {
        schema = classSchema(db, p.cid);
        if (!schema || schema.family !== 'operation')
            throw new DataError(`класс операции ${p.cid} не найден`);
        const time = isEmpty(p.time) ? Date.now() : parseTime(p.time, 'дата операции');
        op = { id: '', cid: schema.cid, time, body: validateBody(db, schema, p.body ?? {}) };
    }
    assertRules(db, schema);
    const { entries, errors } = computeEntries(db, schema, op);
    return { entries: entries.map(e => presentEntry({ ...e, time: op.time, storno: 0 })), errors };
}

/** Проводка для показа: amount — в рублях, аналитики сторон — { слот: id }. */
export function presentEntry(e) {
    const side = a => Object.fromEntries(Object.entries(a).map(([slot, v]) => [slot, v.ref_id]));
    return {
        ...(e.id !== undefined ? { id: e.id, op_id: e.op_id, op_version: e.op_version, op_cid: e.op_cid } : {}),
        rule: e.rule,
        row: e.row,
        time: e.time,
        debit: e.debit_cid,
        credit: e.credit_cid,
        amount: e.amount / 100,
        qty: e.qty,
        qty2: e.qty2,
        doc_qty: e.doc_qty,
        doc_unit: e.doc_unit,
        debit_analytics: side(e.analytics.D),
        credit_analytics: side(e.analytics.C),
        ...(e.id !== undefined ? { author: e.author, place: e.place, unit: e.unit } : {}),
        storno: !!e.storno,
    };
}

/**
 * Проводки операции (amount — в рублях).
 * @param {object} [opts] { history — все проводки всех версий, включая сторно; иначе — действующие }
 */
export function operationEntries(db, id, { history = false } = {}) {
    const { op } = mustOperation(db, id);
    if (!history)
        return op.status === 'registered' ? effectiveRows(db, op.id).map(presentEntry) : [];
    return db.prepare('SELECT * FROM entries WHERE op_id = ? ORDER BY id').all(op.id)
        .map(r => presentEntry({ ...r, analytics: analyticsOf(db, r.id) }));
}
