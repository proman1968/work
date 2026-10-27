/**
 * Схема класса данных, собранная по трёхосевому наследованию, и её проверка.
 *
 * Трёхосевое наследование метаданных (приоритет от базового к приоритетному):
 *   1. Types (миксины: `types` в class.js) — расширяющие классы;
 *   2. Ancestor (одноимённый класс в корневом модуле /MODULES или /DATA, либо явный `ancestor`/`extends`);
 *   3. Parent (цепочка предков одного семейства в текущем дереве);
 *   4. Сам класс (собственный слой class.js).
 *
 * Правила слияния слоёв:
 *   - FIELDS   — слияние по id: более приоритетный слой уточняет свойства поля, новые поля — в конец;
 *                `removed: true` убирает унаследованное поле; поле с `to_inherit: false`
 *                действует только в своём классе (и его прямом наследнике по Ancestor);
 *   - POSTINGS — слияние по id: debit/credit и их analytics уточняются по ключам;
 *                `removed: true` убирает унаследованное правило;
 *   - OVERLAY  — поля записей-расширений виртуального справочника (как FIELDS);
 *   - AUTO_REGISTER, SOURCE — ближайшее определённое значение;
 *   - STATIC   — свойства самого класса (с учётом Ancestor).
 *
 * Если поле ссылается на класс-структуру ($struct):
 *   - при `table: false` (по умолчанию) тип поля — `'struct'` (вложенный объект со всеми полями структуры, рекурсивно);
 *   - при `table: true` тип поля — `'table'` (массив объектов этой структуры).
 * Если поле ссылается на справочник ($catalog, $virtual) — тип поля `'link'`.
 */
import { getClass, ancestors, isLeaf, classesGeneration } from './classes.js';
import { compile, BUILTIN_FUNCTIONS } from './expr.js';

/** Семейство типа класса: схема наследуется внутри семейства. */
export const FAMILY = Object.freeze({
    $catalog: 'catalog', $registry: 'catalog', $virtual: 'catalog',
    $struct: 'struct',
    $operation: 'operation',
    $account: 'account', $register: 'account',
    $structure: 'structure', $base: 'structure',
    $module: 'module',
});

/** Канонические типы полей и их синонимы в class.js. */
export const FIELD_TYPES = Object.freeze(['string', 'text', 'number', 'money', 'integer', 'boolean', 'date', 'datetime', 'link', 'struct', 'table', 'enum', 'file']);
const TYPE_ALIASES = { timestamp: 'datetime', time: 'datetime', bool: 'boolean', int: 'integer', ref: 'link', array: 'table', structure: 'struct' };

/** Функции, которые ядро проведения передаёт в выражения правил. */
export const RULE_FUNCTIONS = Object.freeze(['norm', 'coef', 'unit_cost']);

/** Нормализованный тип поля ('' — неизвестный). */
export function fieldType(raw) {
    const t = String(raw ?? 'string').trim().toLowerCase();
    const n = TYPE_ALIASES[t] || t;
    return FIELD_TYPES.includes(n) ? n : '';
}

function clone(v) {
    return v === undefined ? undefined : structuredClone(v);
}

/** Слияние списков по id. inherited — признак слоя предка по Parent (учёт to_inherit:false). */
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
    const prevSub = prev.FIELDS ?? prev.fields;
    const rawSub = raw.FIELDS ?? raw.fields;
    if (Array.isArray(prevSub) && Array.isArray(rawSub)) {
        f.FIELDS = mergeById(clone(prevSub), rawSub, false, mergeField);
        delete f.fields;
    }
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
    if (r.quantity !== undefined && r.qty === undefined)
        r.qty = r.quantity;
    delete r.quantity;
    delete r.removed;
    delete r.to_inherit;
    return r;
}

/** Путь организации ($base), внутри которой находится класс (или '' для корня). */
export function classBasePath(db, cid) {
    const chain = ancestors(db, cid, { self: true });
    for (let i = chain.length - 1; i >= 0; i--) {
        if (chain[i].type === '$base')
            return chain[i].path;
    }
    const m = /^(\/MODULES\/[^/]+)\//.exec(String(cid || ''));
    if (m)
        return m[1];
    return '';
}

/**
 * Разрешить ссылку на класс в контексте организации ($base):
 * если внутри $base материализован одноимённый класс (`basePath + refPath`),
 * используется он, иначе — указанный путь `refPath`.
 */
export function resolveInBase(db, basePath, refPath) {
    const ref = String(refPath ?? '').trim();
    if (!ref || !basePath || !ref.startsWith('/') || ref === basePath || ref.startsWith(basePath + '/'))
        return ref;
    const candidates = [basePath + ref];
    if (ref.startsWith('/DATA/'))
        candidates.push(basePath + '/MODULES/Register' + ref.slice('/DATA'.length), basePath + ref.slice('/DATA'.length));
    else if (ref.startsWith('/MODULES/')) {
        candidates.push(basePath + ref.slice('/MODULES'.length));
        if (ref.startsWith('/MODULES/Register/'))
            candidates.push(basePath + '/DATA' + ref.slice('/MODULES/Register'.length), basePath + ref.slice('/MODULES/Register'.length));
    }
    for (const cand of candidates) {
        if (getClass(db, cand))
            return cand;
    }
    return ref;
}

/**
 * Найти класс-предок по оси Ancestor (одноимённый класс в корневом модуле /MODULES или /DATA,
 * либо явно указанный в `ancestor`/`extends`).
 */
export function findAncestor(db, cls) {
    if (!cls)
        return null;
    const explicit = cls.own?.ancestor ?? cls.own?.extends ?? cls.own?.METADATA?.ancestor ?? cls.own?.METADATA?.extends;
    if (typeof explicit === 'string' && explicit.trim()) {
        const hit = getClass(db, explicit.trim());
        if (hit && hit.cid !== cls.cid)
            return hit;
    }
    const basePath = classBasePath(db, cls.cid);
    if (!basePath || cls.path === basePath)
        return null;
    const rel = cls.path.slice(basePath.length);
    if (!rel || rel === '/')
        return null;
    const candidates = [rel];
    if (rel.startsWith('/DATA/'))
        candidates.push('/MODULES/Register' + rel.slice('/DATA'.length));
    else if (rel.startsWith('/MODULES/Register/'))
        candidates.push('/DATA' + rel.slice('/MODULES/Register'.length));
    else if (!rel.startsWith('/MODULES/'))
        candidates.push('/MODULES' + rel, '/DATA' + rel, '/MODULES/Register' + rel);

    for (const cand of candidates) {
        if (cand === cls.cid)
            continue;
        const hit = getClass(db, cand);
        if (hit && FAMILY[hit.type] === FAMILY[cls.type])
            return hit;
    }
    return null;
}

/** Цепочка предков одного семейства от корня семейства до cls включительно. */
function sameFamilyChain(db, cls) {
    const family = FAMILY[cls.type] || 'other';
    const chain = ancestors(db, cls.cid);
    let from = chain.length - 1;
    while (from > 0 && FAMILY[chain[from - 1].type] === family)
        from--;
    return chain.slice(from);
}

/** Список ссылок `types` (миксинов) из собственного слоя класса. */
function ownTypes(own) {
    const raw = own?.types ?? own?.TYPES ?? own?.METADATA?.types ?? own?.METADATA?.TYPES;
    return Array.isArray(raw) ? raw.map(x => String(x || '').trim()).filter(Boolean) : [];
}

/**
 * Нормализовать поле (рекурсивно для структур $struct и табличных полей table: true).
 */
function normalizeField(db, f, basePath = '', seenStructs = new Set()) {
    const rawType = String(f.type ?? '').trim();
    const normType = fieldType(f.type);
    const isTable = f.table === true || normType === 'table';
    const pathFromType = rawType.startsWith('/') ? rawType : '';
    const rawRef = String(f.struct ?? f.target ?? f.catalog ?? pathFromType).trim();
    const refPath = rawRef ? resolveInBase(db, basePath, rawRef) : '';
    const refCls = (db && refPath) ? getClass(db, refPath) : null;
    const isStruct = refCls?.type === '$struct' || normType === 'struct' || Boolean(f.struct);

    if (isStruct) {
        let baseFields = [];
        if (refCls?.type === '$struct' && !seenStructs.has(refCls.cid)) {
            const nextSeen = new Set(seenStructs);
            nextSeen.add(refCls.cid);
            const structSchema = classSchema(db, refCls.cid, nextSeen);
            baseFields = (structSchema?.fields || []).map(clone);
        }
        const localRaw = (Array.isArray(f.FIELDS) ? f.FIELDS : Array.isArray(f.fields) ? f.fields : []).filter(x => x && x.id);
        const merged = localRaw.length
            ? mergeById(baseFields, localRaw, false, mergeField).map(x => normalizeField(db, { ...x, id: String(x.id) }, basePath, seenStructs))
            : baseFields;
        const out = {
            ...f,
            type: isTable ? 'table' : 'struct',
            table: isTable,
            fields: merged,
        };
        if (refCls)
            out.struct = refCls.cid;
        else if (refPath)
            out.struct = refPath;
        delete out.FIELDS;
        delete out.catalog;
        delete out.target;
        out.label ??= f.id;
        return out;
    }

    if (isTable) {
        const sub = (Array.isArray(f.FIELDS) ? f.FIELDS : Array.isArray(f.fields) ? f.fields : [])
            .filter(x => x && x.id).map(x => normalizeField(db, { ...x, id: String(x.id) }, basePath, seenStructs));
        const out = { ...f, type: 'table', table: true, fields: sub };
        delete out.FIELDS;
        out.label ??= f.id;
        return out;
    }

    if (normType === 'link' || pathFromType) {
        const out = { ...f, type: 'link', target: refCls ? refCls.cid : refPath };
        delete out.catalog;
        delete out.FIELDS;
        out.label ??= f.id;
        return out;
    }

    const out = { ...f, type: normType || 'string' };
    if (!normType)
        out.unknownType = String(f.type);
    delete out.FIELDS;
    out.label ??= f.id;
    return out;
}

const cache = new WeakMap();

/**
 * Схема класса по трёхосевому наследованию: Types → Ancestor → Parent → Сам класс.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} ref путь класса
 * @param {Set<string>} [seenStructs] защита от циклов вложенных структур
 * @returns {{cid, path, type, family, label, leaf, ancestor: string|null, types: string[],
 *            fields: object[], postings: object[], overlay: object[], autoRegister: boolean,
 *            source: object|null, static: object[]} | null}
 */
export function classSchema(db, ref, seenStructs = new Set()) {
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
    const basePath = classBasePath(db, cls.cid);
    const parentChain = sameFamilyChain(db, cls); // [P_0, ..., cls]

    // Находим глубочайший класс в цепочке Parent, у которого есть Ancestor в корне/модуле
    let matchedAnc = null;
    let matchedAtSelf = false;
    for (let i = parentChain.length - 1; i >= 0; i--) {
        const a = findAncestor(db, parentChain[i]);
        if (a) {
            matchedAnc = a;
            matchedAtSelf = (i === parentChain.length - 1);
            break;
        }
    }
    const ancChain = matchedAnc ? sameFamilyChain(db, matchedAnc) : [];

    // Собираем все ссылки Types (миксины) из Ancestor-цепочки и Parent-цепочки
    const typeRefs = [];
    for (const l of [...ancChain, ...parentChain]) {
        for (const t of ownTypes(l.own)) {
            const resolved = resolveInBase(db, basePath, t);
            if (!typeRefs.includes(resolved) && resolved !== cls.cid)
                typeRefs.push(resolved);
        }
    }

    // 1. Types (миксины) → 2. Ancestor → 3. Parent → 4. Сам класс
    const sequence = [];
    const visitedTypeCids = new Set([cls.cid]);
    for (const tRef of typeRefs) {
        const tCls = getClass(db, tRef);
        if (!tCls || visitedTypeCids.has(tCls.cid))
            continue;
        visitedTypeCids.add(tCls.cid);
        const tChain = sameFamilyChain(db, tCls);
        tChain.forEach((tl, idx) => {
            sequence.push({ layer: tl, inherited: idx < tChain.length - 1 });
        });
    }
    ancChain.forEach((al, idx) => {
        const isDirectAncestorOfSelf = matchedAtSelf && idx === ancChain.length - 1;
        sequence.push({ layer: al, inherited: !isDirectAncestorOfSelf });
    });
    parentChain.slice(0, -1).forEach(pl => {
        sequence.push({ layer: pl, inherited: true });
    });
    sequence.push({ layer: cls, inherited: false });

    let fields = [], postings = [], overlay = [], staticFields = [];
    let autoRegister = false, source = null, norms = null;
    for (const { layer, inherited } of sequence) {
        const own = layer.own || {};
        const meta = own.METADATA || {};
        fields = mergeById(fields, meta.FIELDS, inherited, mergeField);
        postings = mergeById(postings, meta.POSTINGS, inherited, mergeRule);
        overlay = mergeById(overlay, own.OVERLAY ?? meta.OVERLAY, inherited, mergeField);
        if (!inherited && Array.isArray(meta.STATIC))
            staticFields = mergeById(staticFields, meta.STATIC, false, mergeField);
        if (typeof own.AUTO_REGISTER === 'boolean')
            autoRegister = own.AUTO_REGISTER;
        if (own.SOURCE && typeof own.SOURCE === 'object')
            source = { ...(source || {}), ...clone(own.SOURCE) };
        if (own.NORMS !== undefined)
            norms = clone(own.NORMS);
    }

    // Привязываем ссылки на счета и источники виртуального справочника к контексту $base
    if (basePath) {
        postings = postings.map(r => ({
            ...r,
            debit: r.debit?.account ? { ...r.debit, account: resolveInBase(db, basePath, r.debit.account) } : r.debit,
            credit: r.credit?.account ? { ...r.credit, account: resolveInBase(db, basePath, r.credit.account) } : r.credit,
        }));
        if (source) {
            if (source.registry)
                source.registry = resolveInBase(db, basePath, source.registry);
            if (source.account)
                source.account = resolveInBase(db, basePath, source.account);
        }
    }

    const directAnc = findAncestor(db, cls);
    // Класс является листом, если у него нет дочерних классов в текущем дереве И у его прямого Ancestor нет дочерних классов
    const leaf = isLeaf(db, cls.cid) && (!directAnc || isLeaf(db, directAnc.cid));

    const schema = {
        cid: cls.cid,
        path: cls.path,
        type: cls.type,
        family,
        label: cls.label,
        leaf,
        ancestor: directAnc ? directAnc.cid : null,
        types: typeRefs,
        fields: fields.map(f => normalizeField(db, f, basePath, seenStructs)),
        postings,
        overlay: overlay.map(f => normalizeField(db, f, basePath, seenStructs)),
        autoRegister,
        source,
        norms,
        static: staticFields,
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
    for (const tRef of s.types || []) {
        if (!getClass(db, tRef))
            errors.push(`${at}: тип-миксин (types) ${tRef} не найден`);
    }
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
            if (f.type === 'struct' || f.type === 'table') {
                if (f.struct) {
                    const sc = getClass(db, f.struct);
                    if (!sc)
                        errors.push(`${at}: поле «${where}${f.id}» — структура ${f.struct} не найдена`);
                    else if (sc.type !== '$struct')
                        errors.push(`${at}: поле «${where}${f.id}» — класс ${f.struct} не является структурой ($struct)`);
                }
                if (!f.fields.length)
                    errors.push(`${at}: ${f.type === 'table' ? 'табличная часть' : 'структура'} «${where}${f.id}» без полей`);
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
