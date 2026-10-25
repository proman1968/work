/**
 * Схема класса данных, собранная по наследованию, и её проверка.
 *
 * Схема собирается из собственных слоёв class.js цепочки предков одного
 * семейства (справочники, операции, счета, структура) — от корня к классу:
 *   - FIELDS   — слияние по id: потомок уточняет свойства поля, новые поля — в конец;
 *                `removed: true` убирает унаследованное поле; поле с `to_inherit: false`
 *                действует только в своём классе;
 *   - POSTINGS — слияние по id: debit/credit и их analytics уточняются по ключам;
 *                `removed: true` убирает унаследованное правило (ключи правила — posting.js);
 *   - OVERLAY  — поля записей-расширений виртуального справочника (как FIELDS);
 *   - AUTO_REGISTER, SOURCE — ближайшее определённое значение;
 *   - STATIC   — не наследуется (свойства самого класса).
 */
import { getClass, ancestors, isLeaf, classesGeneration } from './classes.js';
import { compile, BUILTIN_FUNCTIONS } from './expr.js';

/** Семейство типа класса: схема наследуется только внутри семейства. */
export const FAMILY = Object.freeze({
    $catalog: 'catalog', $registry: 'catalog', $virtual: 'catalog',
    $operation: 'operation',
    $account: 'account', $register: 'account',
    $structure: 'structure', $base: 'structure',
});

/** Канонические типы полей и их синонимы в существующих class.js. */
export const FIELD_TYPES = Object.freeze(['string', 'text', 'number', 'money', 'integer', 'boolean', 'date', 'datetime', 'link', 'table', 'enum', 'file']);
const TYPE_ALIASES = { timestamp: 'datetime', time: 'datetime', bool: 'boolean', int: 'integer', ref: 'link', array: 'table' };

/** Функции, которые ядро проведения передаёт в выражения правил. */
export const RULE_FUNCTIONS = Object.freeze(['norm', 'coef']);

/** Нормализованный тип поля ('' — неизвестный). */
export function fieldType(raw) {
    const t = String(raw ?? 'string').trim().toLowerCase();
    const n = TYPE_ALIASES[t] || t;
    return FIELD_TYPES.includes(n) ? n : '';
}

function clone(v) {
    return v === undefined ? undefined : structuredClone(v);
}

/** Слияние списков по id. inherited — признак слоя предка (учёт to_inherit:false). */
function mergeById(base, layer, inherited, mergeItem) {
    const out = base;
    for (const raw of Array.isArray(layer) ? layer : []) {
        if (!raw || typeof raw !== 'object' || !raw.id)
            continue;
        if (inherited && raw.to_inherit === false)
            continue;
        const id = String(raw.id);
        const i = out.findIndex(x => x.id === id);
        if (raw.removed) {
            if (i >= 0)
                out.splice(i, 1);
            continue;
        }
        if (i >= 0)
            out[i] = mergeItem(out[i], raw);
        else
            out.push(mergeItem({}, raw));
    }
    return out;
}

function mergeField(prev, raw) {
    const f = { ...prev, ...clone(raw), id: String(raw.id) };
    delete f.to_inherit;
    delete f.removed;
    return f;
}

function mergeSide(prev, raw) {
    if (!raw)
        return prev;
    return {
        ...prev,
        ...clone(raw),
        analytics: { ...(prev?.analytics || {}), ...(clone(raw.analytics) || {}) },
    };
}

function mergeRule(prev, raw) {
    const r = { ...prev, ...clone(raw), id: String(raw.id) };
    r.debit = mergeSide(prev.debit, raw.debit);
    r.credit = mergeSide(prev.credit, raw.credit);
    // устаревшее имя количества в class.js
    if (r.quantity !== undefined && r.qty === undefined)
        r.qty = r.quantity;
    delete r.quantity;
    delete r.removed;
    delete r.to_inherit;
    return r;
}

/** Нормализовать поле (рекурсивно для табличных частей). */
function normalizeField(f) {
    const type = fieldType(f.type);
    const out = { ...f, type: type || 'string' };
    if (!type)
        out.unknownType = String(f.type);
    if (type === 'link') {
        out.target = String(f.target ?? f.catalog ?? '');
        delete out.catalog;
    }
    if (type === 'table')
        out.fields = (Array.isArray(f.FIELDS) ? f.FIELDS : Array.isArray(f.fields) ? f.fields : [])
            .filter(x => x && x.id).map(x => normalizeField({ ...x, id: String(x.id) }));
    delete out.FIELDS;
    out.label ??= f.id;
    return out;
}

const cache = new WeakMap();

/**
 * Схема класса (с кэшем до изменения дерева классов).
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} ref cid или путь класса
 * @returns {{cid, path, type, family, label, leaf, fields: object[], postings: object[],
 *            overlay: object[], autoRegister: boolean, source: object|null, static: object[]} | null}
 */
export function classSchema(db, ref) {
    const cls = getClass(db, ref);
    if (!cls)
        return null;
    let byDb = cache.get(db);
    if (!byDb || byDb.gen !== classesGeneration(db)) {
        byDb = { gen: classesGeneration(db), map: new Map() };
        cache.set(db, byDb);
    }
    const hit = byDb.map.get(cls.cid);
    if (hit)
        return hit;

    const family = FAMILY[cls.type] || 'other';
    const chain = ancestors(db, cls.cid);
    let from = chain.length - 1;
    while (from > 0 && FAMILY[chain[from - 1].type] === family)
        from--;
    const layers = chain.slice(from);

    let fields = [], postings = [], overlay = [];
    let autoRegister = false, source = null;
    layers.forEach((layer, i) => {
        const own = layer.own || {};
        const meta = own.METADATA || {};
        const inherited = i < layers.length - 1;
        fields = mergeById(fields, meta.FIELDS, inherited, mergeField);
        postings = mergeById(postings, meta.POSTINGS, inherited, mergeRule);
        overlay = mergeById(overlay, own.OVERLAY ?? meta.OVERLAY, inherited, mergeField);
        if (typeof own.AUTO_REGISTER === 'boolean')
            autoRegister = own.AUTO_REGISTER;
        if (own.SOURCE && typeof own.SOURCE === 'object')
            source = clone(own.SOURCE);
    });

    const schema = {
        cid: cls.cid,
        path: cls.path,
        type: cls.type,
        family,
        label: cls.label,
        leaf: isLeaf(db, cls.cid),
        fields: fields.map(normalizeField),
        postings,
        overlay: overlay.map(normalizeField),
        autoRegister,
        source,
        static: clone(cls.own?.METADATA?.STATIC) || [],
    };
    byDb.map.set(cls.cid, schema);
    return schema;
}

/** Поля-аналитики счёта (Link с analytic: true). */
export function analyticSlots(schema) {
    return schema.fields.filter(f => f.analytic && f.type === 'link');
}

/** Заголовок объекта по схеме: поле name, иначе первое строковое. */
export function objectTitle(schema, body = {}) {
    if (body.name)
        return String(body.name);
    const f = schema?.fields.find(x => (x.type === 'string' || x.type === 'text') && body[x.id]);
    return f ? String(body[f.id]) : '';
}

/**
 * Проверка схемы класса. Для листа операций — полнота правил проводок:
 * оба счёта существуют, это листья-счета, выражения разбираются и ссылаются
 * на известные поля, все аналитики счетов сопоставлены.
 * @returns {string[]} ошибки (пусто — схема корректна)
 */
export function checkSchema(db, ref) {
    const s = classSchema(db, ref);
    if (!s)
        return [`класс ${ref} не найден`];
    const errors = [];
    const at = `${s.path}`;
    const checkFields = (list, where) => {
        const ids = new Set();
        for (const f of list) {
            if (ids.has(f.id))
                errors.push(`${at}: поле «${where}${f.id}» объявлено дважды`);
            ids.add(f.id);
            if (f.unknownType)
                errors.push(`${at}: поле «${where}${f.id}» — неизвестный тип «${f.unknownType}»`);
            if (f.type === 'link') {
                if (!f.target)
                    errors.push(`${at}: поле-ссылка «${where}${f.id}» без целевого класса (target)`);
                else if (!getClass(db, f.target))
                    errors.push(`${at}: поле-ссылка «${where}${f.id}» — класс ${f.target} не найден`);
            }
            if (f.type === 'table') {
                if (!f.fields.length)
                    errors.push(`${at}: табличная часть «${where}${f.id}» без полей`);
                checkFields(f.fields, `${where}${f.id}.`);
            }
        }
    };
    checkFields(s.fields, '');
    checkFields(s.overlay, 'overlay.');

    if (s.family === 'operation' && s.leaf)
        for (const rule of s.postings)
            errors.push(...checkRule(db, s, rule));
    return errors;
}

function checkRule(db, s, rule) {
    const errors = [];
    const at = `${s.path}: правило «${rule.id}»`;
    const top = new Set(s.fields.map(f => f.id));
    let rowFields = null;
    if (rule.each) {
        const table = s.fields.find(f => f.id === rule.each);
        if (!table || table.type !== 'table')
            errors.push(`${at}: each — «${rule.each}» не табличная часть`);
        else
            rowFields = new Set(table.fields.map(f => f.id));
    }
    const known = new Set([...BUILTIN_FUNCTIONS, ...RULE_FUNCTIONS]);
    const checkExpr = (src, what) => {
        let c;
        try {
            c = compile(src);
        }
        catch (e) {
            errors.push(`${at}: ${what} — ${e.message}`);
            return;
        }
        for (const name of c.names) {
            if (name === 'row' && rowFields)
                continue;
            if (!top.has(name))
                errors.push(`${at}: ${what} — неизвестное поле «${name}»`);
        }
        for (const fn of c.calls) {
            if (!known.has(fn))
                errors.push(`${at}: ${what} — неизвестная функция ${fn}()`);
        }
    };

    if (rule.amount === undefined && rule.qty === undefined)
        errors.push(`${at}: нет ни суммы (amount), ни количества (qty)`);
    for (const key of ['amount', 'qty', 'qty2', 'unit', 'item', 'when']) {
        if (rule[key] !== undefined && rule[key] !== '')
            checkExpr(rule[key], key);
    }
    if (rule.unit && !rule.item)
        errors.push(`${at}: единица (unit) без номенклатуры (item) — коэффициент к базовой единице не определить`);
    for (const side of ['debit', 'credit']) {
        const acc = rule[side]?.account;
        const name = side === 'debit' ? 'дебет' : 'кредит';
        if (!acc) {
            errors.push(`${at}: не задан счёт (${name})`);
            continue;
        }
        const accSchema = classSchema(db, acc);
        if (!accSchema) {
            errors.push(`${at}: счёт ${acc} (${name}) не найден`);
            continue;
        }
        if (accSchema.type !== '$account')
            errors.push(`${at}: ${acc} (${name}) — не счёт`);
        else if (!accSchema.leaf)
            errors.push(`${at}: ${acc} (${name}) — не лист, проводка возможна только на субсчёт`);
        const map = rule[side].analytics || {};
        for (const slot of analyticSlots(accSchema)) {
            if (map[slot.id] === undefined || map[slot.id] === '')
                errors.push(`${at}: аналитика «${slot.id}» счёта ${accSchema.label} (${name}) не сопоставлена`);
            else
                checkExpr(map[slot.id], `аналитика ${name} «${slot.id}»`);
        }
        for (const key of Object.keys(map)) {
            if (!analyticSlots(accSchema).some(f => f.id === key))
                errors.push(`${at}: у счёта ${accSchema.label} нет аналитики «${key}» (${name})`);
        }
    }
    return errors;
}
