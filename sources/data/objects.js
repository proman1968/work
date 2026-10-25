/**
 * Объекты справочников и операций: создание, правка с версиями во времени,
 * удаление с защитой ссылок, чтение «как было на дату», выборки и поиск.
 *
 * Объект создаётся только в классе-листе своего семейства (справочник или
 * операция). Тело проверяется по схеме класса (schema.js): типы приводятся,
 * обязательные поля проверяются, ссылки должны вести на существующие
 * неудалённые объекты целевого класса или его потомков, лишние поля — ошибка.
 *
 * Каждая запись — новая версия в object_versions; `valid_from` версии задаёт,
 * с какого момента она действует (первая версия справочника действует всегда).
 * Зарегистрированная операция здесь не меняется — это делает проведение
 * (posting.js: исправление — сторно и новые проводки). Операция класса с
 * AUTO_REGISTER регистрируется в транзакции создания.
 */
import crypto from 'node:crypto';
import { tx } from './db.js';
import { getClass, descendants } from './classes.js';
import { classSchema, objectTitle, FAMILY } from './schema.js';
import { toNumber, round } from './expr.js';
import { DataError } from './errors.js';
import { parseTime, localDay, periodRange } from './time.js';
import { registerOperation } from './posting.js';

/** Допустимые статусы по семейству. */
export const STATUSES = Object.freeze({
    catalog: ['active', 'deleted'],
    operation: ['draft', 'registered', 'cancelled', 'deleted'],
});

/** Системные колонки, доступные в фильтрах и сортировке наравне с полями. */
const COLUMNS = new Set(['id', 'cid', 'status', 'time', 'author', 'place', 'unit', 'ext_of', 'version', 'created', 'updated']);

const MAX_LIMIT = 500;

/** Новый id объекта: время создания (base36) + случайный хвост; сортируется по времени. */
export function newId(now = Date.now()) {
    return now.toString(36).padStart(9, '0') + crypto.randomBytes(5).toString('hex');
}

const isEmpty = v => v === undefined || v === null || v === '';

/* ---------- проверка тела по схеме ---------- */

/** Классы, объекты которых допустимы в ссылке на target. Виртуальный — объекты его реестра-источника. */
export function linkCids(db, target) {
    const t = classSchema(db, target);
    if (!t)
        return null;
    if (t.type === '$virtual' && t.source?.registry) {
        const reg = getClass(db, t.source.registry);
        return reg ? descendants(db, reg.cid) : null;
    }
    return descendants(db, t.cid);
}

function coerce(db, field, value, errors, path) {
    const fail = msg => {
        errors.push({ field: path, message: msg });
        return undefined;
    };
    switch (field.type) {
        case 'string':
        case 'text':
        case 'file':
            return String(value);
        case 'enum': {
            const values = (field.values || field.options || []).map(v => (typeof v === 'object' ? String(v.id) : String(v)));
            const s = String(typeof value === 'object' ? value?.id : value);
            return values.length && !values.includes(s) ? fail(`«${s}» — нет в списке (${values.join(', ')})`) : s;
        }
        case 'number':
        case 'money':
        case 'integer': {
            let n;
            try {
                n = toNumber(typeof value === 'string' ? value.replace(/\s/g, '').replace(',', '.') : value);
            }
            catch {
                return fail(`«${value}» — не число`);
            }
            if (field.type === 'integer' && !Number.isInteger(n))
                return fail(`«${value}» — не целое`);
            return field.type === 'money' ? round(n, 2) : n;
        }
        case 'boolean': {
            if (typeof value === 'boolean')
                return value;
            const s = String(value).trim().toLowerCase();
            if (['true', '1', 'да', 'yes'].includes(s))
                return true;
            if (['false', '0', 'нет', 'no'].includes(s))
                return false;
            return fail(`«${value}» — не да/нет`);
        }
        case 'date':
        case 'datetime': {
            let t;
            try {
                t = parseTime(value);
            }
            catch {
                return fail(`«${value}» — не дата`);
            }
            return field.type === 'date' ? localDay(t) : t;
        }
        case 'link': {
            const id = String(typeof value === 'object' ? value?.id ?? '' : value);
            const cids = linkCids(db, field.target);
            if (!cids)
                return fail(`класс ссылки ${field.target} не найден`);
            const row = db.prepare('SELECT cid, status FROM objects WHERE id = ?').get(id);
            if (!row || !cids.includes(row.cid))
                return fail(`объект ${id} не найден в ${getClass(db, field.target)?.label ?? field.target}`);
            if (row.status === 'deleted')
                return fail(`объект ${id} удалён`);
            return id;
        }
        case 'table': {
            if (!Array.isArray(value))
                return fail('ожидается список строк');
            return value.map((row, i) => checkBody(db, field.fields, row, errors, `${path}[${i + 1}].`));
        }
    }
    return fail(`неизвестный тип ${field.type}`);
}

/**
 * Проверить и привести тело по списку полей.
 * @returns {object} приведённое тело (пустые значения не хранятся)
 */
function checkBody(db, fields, body, errors, prefix = '') {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        errors.push({ field: prefix.replace(/\.$/, '') || undefined, message: 'ожидается объект' });
        return {};
    }
    const byId = new Map(fields.map(f => [f.id, f]));
    for (const key of Object.keys(body)) {
        if (!byId.has(key))
            errors.push({ field: prefix + key, message: 'нет такого поля в схеме класса' });
    }
    const out = {};
    for (const f of fields) {
        const v = body[f.id];
        if (isEmpty(v) || (Array.isArray(v) && !v.length && f.type === 'table')) {
            if (f.required)
                errors.push({ field: prefix + f.id, message: 'обязательное поле' });
            continue;
        }
        const c = coerce(db, f, v, errors, prefix + f.id);
        if (c !== undefined)
            out[f.id] = c;
    }
    return out;
}

/** Поля тела объекта класса (для записи-расширения виртуального справочника — его поля и OVERLAY). */
function bodyFields(schema) {
    return schema.type === '$virtual' ? [...schema.fields, ...schema.overlay] : schema.fields;
}

/** Проверить тело объекта класса; ошибки — DataError со списком. */
export function validateBody(db, schema, body) {
    const errors = [];
    const out = checkBody(db, bodyFields(schema), body ?? {}, errors);
    if (errors.length)
        throw new DataError(`${schema.label}: данные не прошли проверку`, errors);
    return out;
}

/* ---------- производные: ссылки и поиск ---------- */

function collectRefs(db, fields, body, prefix = '', row = -1, out = []) {
    for (const f of fields) {
        const v = body[f.id];
        if (isEmpty(v))
            continue;
        if (f.type === 'link')
            out.push({ field: prefix + f.id, row, ref_id: v, ref_cid: db.prepare('SELECT cid FROM objects WHERE id = ?').get(v)?.cid ?? null });
        if (f.type === 'table')
            v.forEach((r, i) => collectRefs(db, f.fields, r, f.id + '.', i, out));
    }
    return out;
}

function searchText(schema, body) {
    const parts = [objectTitle(schema, body)];
    const walk = (fields, b) => {
        for (const f of fields) {
            const v = b[f.id];
            if (isEmpty(v))
                continue;
            if (['string', 'text', 'enum'].includes(f.type))
                parts.push(String(v));
            if (f.type === 'table')
                v.forEach(r => walk(f.fields, r));
        }
    };
    walk(bodyFields(schema), body);
    return parts.filter(Boolean).join('\n');
}

function writeDerived(db, schema, id, body) {
    db.prepare('DELETE FROM refs WHERE obj_id = ?').run(id);
    const ins = db.prepare('INSERT INTO refs (obj_id, field, row, ref_id, ref_cid) VALUES (?, ?, ?, ?, ?)');
    for (const r of collectRefs(db, bodyFields(schema), body))
        ins.run(id, r.field, r.row, r.ref_id, r.ref_cid);
    const rowid = db.prepare('SELECT rowid FROM objects WHERE id = ?').get(id).rowid;
    db.prepare('DELETE FROM objects_fts WHERE rowid = ?').run(rowid);
    db.prepare('INSERT INTO objects_fts (rowid, text) VALUES (?, ?)').run(rowid, searchText(schema, body));
}

/* ---------- чтение ---------- */

function toObject(row, schema) {
    if (!row)
        return null;
    const body = JSON.parse(row.body);
    return { ...row, body, title: objectTitle(schema, body) };
}

const SELECT = 'SELECT id, cid, status, time, author, place, unit, ext_of, version, created, updated, body FROM objects';

/**
 * Объект по id. С `at` — состояние версии, действовавшей в этот момент
 * (null, если объекта тогда ещё не было).
 * @param {object} [opts] { at?: момент (мс, дата, ISO) }
 */
export function readObject(db, id, { at } = {}) {
    const row = db.prepare(`${SELECT} WHERE id = ?`).get(String(id));
    if (!row)
        return null;
    const schema = classSchema(db, row.cid);
    if (at === undefined || at === null || at === '')
        return toObject(row, schema);
    const v = db.prepare(`SELECT version, status, body, valid_from FROM object_versions
        WHERE id = ? AND valid_from <= ? ORDER BY valid_from DESC, version DESC LIMIT 1`).get(row.id, parseTime(at));
    return v ? toObject({ ...row, version: v.version, status: v.status, body: v.body }, schema) : null;
}

/** Версии объекта, от первой к последней. */
export function objectVersions(db, id) {
    return db.prepare('SELECT version, valid_from, author, status, body FROM object_versions WHERE id = ? ORDER BY version')
        .all(String(id)).map(v => ({ ...v, body: JSON.parse(v.body) }));
}

/** Кто ссылается на объект: объекты (refs) и проводки (аналитики). */
export function referencedBy(db, id) {
    const objects = db.prepare(`SELECT r.obj_id, r.field, r.row, o.cid, o.status FROM refs r JOIN objects o ON o.id = r.obj_id
        WHERE r.ref_id = ? AND o.status <> 'deleted'`).all(String(id));
    const entries = db.prepare('SELECT count(*) n FROM entry_analytics WHERE ref_id = ?').get(String(id)).n;
    return { objects, entries };
}

/* ---------- запись ---------- */

function mustSchema(db, cid) {
    const schema = classSchema(db, cid);
    if (!schema)
        throw new DataError(`класс ${cid} не найден`);
    if (schema.family !== 'catalog' && schema.family !== 'operation')
        throw new DataError(`${schema.label}: в классе типа ${schema.type} объекты не создаются`);
    if (!schema.leaf)
        throw new DataError(`${schema.label}: объекты создаются только в конечном классе (листе)`);
    return schema;
}

function checkUnit(db, unit) {
    if (isEmpty(unit))
        return null;
    const c = getClass(db, unit);
    if (!c || FAMILY[c.type] !== 'structure')
        throw new DataError(`подразделение ${unit} не найдено`);
    return c.cid;
}

/**
 * Создать объект.
 * @param {object} p
 * @param {string} p.cid Класс-лист (cid или путь)
 * @param {object} [p.body] Значения полей
 * @param {*} [p.time] Дата объекта/операции (по умолчанию — сейчас)
 * @param {string} [p.author] uid автора
 * @param {string} [p.place] Рабочее место
 * @param {string} [p.unit] Подразделение (cid структуры)
 * @param {string} [p.ext_of] Для виртуального справочника — id реального объекта
 * @param {*} [p.valid_from] С какого момента действует первая версия (справочник — всегда)
 */
export function createObject(db, p) {
    const schema = mustSchema(db, p.cid);
    const now = Date.now();
    const status = schema.family === 'operation' ? 'draft' : 'active';
    const time = isEmpty(p.time) ? now : parseTime(p.time, 'дата объекта');
    const unit = checkUnit(db, p.unit);
    let extOf = null;
    if (schema.type === '$virtual') {
        const cids = linkCids(db, schema.cid);
        const real = isEmpty(p.ext_of) ? null : db.prepare('SELECT cid, status FROM objects WHERE id = ?').get(String(p.ext_of));
        if (!real || !cids?.includes(real.cid) || real.status === 'deleted')
            throw new DataError(`${schema.label}: запись-расширение требует существующий объект реестра (ext_of)`);
        if (db.prepare(`SELECT 1 FROM objects WHERE cid = ? AND ext_of = ? AND status <> 'deleted'`).get(schema.cid, String(p.ext_of)))
            throw new DataError(`${schema.label}: расширение для ${p.ext_of} уже есть`);
        extOf = String(p.ext_of);
    }
    else if (!isEmpty(p.ext_of))
        throw new DataError(`${schema.label}: ext_of допустим только в виртуальном справочнике`);
    const body = validateBody(db, schema, p.body);
    const validFrom = isEmpty(p.valid_from) ? (schema.family === 'catalog' ? 0 : now) : parseTime(p.valid_from, 'начало действия');
    const id = newId(now);
    tx(db, () => {
        db.prepare(`INSERT INTO objects (id, cid, status, time, author, place, unit, ext_of, version, created, updated, body)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`)
            .run(id, schema.cid, status, time, p.author ?? null, p.place ?? null, unit, extOf, now, now, JSON.stringify(body));
        db.prepare('INSERT INTO object_versions (id, version, valid_from, author, status, body) VALUES (?, 1, ?, ?, ?, ?)')
            .run(id, validFrom, p.author ?? null, status, JSON.stringify(body));
        writeDerived(db, schema, id, body);
        // кто бы ни создавал (человек, ИИ, триггер): ошибка проведения отменяет и создание
        if (schema.family === 'operation' && schema.autoRegister)
            registerOperation(db, { id, author: p.author });
    });
    return readObject(db, id);
}

/**
 * Записать новую версию объекта (общий путь правки, удаления и смены статуса).
 * Внутренний вход для проведения: опция `system` разрешает менять зарегистрированную операцию.
 * @returns {object} объект после записи
 */
export function writeVersion(db, id, { body, status, time, author, valid_from, version, system = false } = {}) {
    const cur = readObject(db, id);
    if (!cur)
        throw new DataError(`объект ${id} не найден`);
    const schema = classSchema(db, cur.cid);
    if (version !== undefined && version !== null && Number(version) !== cur.version)
        throw new DataError(`объект ${cur.title || id} уже изменён (версия ${cur.version}, а не ${version}) — обновите и повторите`);
    if (!system && schema.family === 'operation' && cur.status !== 'draft')
        throw new DataError(`операция «${cur.title || id}» зарегистрирована — изменить её можно только исправлением`);
    const nextStatus = status ?? cur.status;
    if (!STATUSES[schema.family].includes(nextStatus))
        throw new DataError(`статус «${nextStatus}» недопустим для ${schema.label}`);
    const nextBody = body === undefined ? cur.body : validateBody(db, schema, body);
    const nextTime = isEmpty(time) ? cur.time : parseTime(time, 'дата объекта');
    if (nextStatus === cur.status && nextTime === cur.time && JSON.stringify(nextBody) === JSON.stringify(cur.body))
        return cur;
    const now = Date.now();
    const last = db.prepare('SELECT max(valid_from) v FROM object_versions WHERE id = ?').get(cur.id).v;
    const validFrom = isEmpty(valid_from) ? now : parseTime(valid_from, 'начало действия');
    if (validFrom < last)
        throw new DataError(`начало действия версии раньше предыдущей (${localDay(last)})`);
    const v = cur.version + 1;
    tx(db, () => {
        db.prepare('UPDATE objects SET status = ?, time = ?, version = ?, updated = ?, body = ? WHERE id = ?')
            .run(nextStatus, nextTime, v, now, JSON.stringify(nextBody), cur.id);
        db.prepare('INSERT INTO object_versions (id, version, valid_from, author, status, body) VALUES (?, ?, ?, ?, ?, ?)')
            .run(cur.id, v, validFrom, author ?? null, nextStatus, JSON.stringify(nextBody));
        if (nextBody !== cur.body)
            writeDerived(db, schema, cur.id, nextBody);
    });
    return readObject(db, cur.id);
}

/**
 * Изменить поля объекта.
 * @param {object} p { id, body — изменяемые поля (null — очистить), replace? — тело целиком,
 *                     time?, author?, valid_from? — с какого момента действует, version? — ожидаемая версия }
 */
export function updateObject(db, p) {
    const cur = readObject(db, p.id);
    if (!cur)
        throw new DataError(`объект ${p.id} не найден`);
    if (cur.status === 'deleted')
        throw new DataError(`объект «${cur.title || p.id}» удалён`);
    return writeVersion(db, cur.id, { body: mergeBody(cur.body, p), time: p.time, author: p.author, valid_from: p.valid_from, version: p.version });
}

/** Тело после правки: изменяемые поля поверх текущих (null — очистить) или целиком при replace. */
export function mergeBody(current, { body, replace } = {}) {
    if (body === undefined)
        return current;
    const out = replace ? { ...body } : { ...current, ...body };
    for (const [k, v] of Object.entries(out)) {
        if (v === null)
            delete out[k];
    }
    return out;
}

/**
 * Удалить объект (отметка, история сохраняется). Справочник — только если на него
 * не ссылаются объекты и проводки; операция — только черновик.
 */
export function deleteObject(db, { id, author, version } = {}) {
    const cur = readObject(db, id);
    if (!cur)
        throw new DataError(`объект ${id} не найден`);
    if (cur.status === 'deleted')
        return cur;
    const schema = classSchema(db, cur.cid);
    if (schema.family === 'operation' && cur.status !== 'draft')
        throw new DataError(`операция «${cur.title || id}» зарегистрирована — удалить можно только черновик, иначе — отмена`);
    const refs = referencedBy(db, cur.id);
    if (refs.objects.length || refs.entries)
        throw new DataError(`«${cur.title || id}» используется: объектов — ${refs.objects.length}, проводок — ${refs.entries}`);
    return writeVersion(db, cur.id, { status: 'deleted', author, version });
}

/** Восстановить удалённый объект. */
export function restoreObject(db, { id, author } = {}) {
    const cur = readObject(db, id);
    if (!cur)
        throw new DataError(`объект ${id} не найден`);
    if (cur.status !== 'deleted')
        return cur;
    const schema = classSchema(db, cur.cid);
    return writeVersion(db, cur.id, { status: schema.family === 'operation' ? 'draft' : 'active', author, system: true });
}

/* ---------- выборки ---------- */

const OPS = { eq: '=', ne: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' };

/** Поля класса и его потомков (запрос к родителю фильтрует и по полям наследников). */
function knownFields(db, schema) {
    const ids = new Set();
    for (const cid of descendants(db, schema.cid)) {
        const s = classSchema(db, cid);
        for (const f of [...s.fields, ...s.overlay])
            ids.add(f.id);
    }
    return ids;
}

function columnExpr(db, schema, key, args) {
    if (COLUMNS.has(key))
        return `o.${key}`;
    if (!knownFields(db, schema).has(key))
        throw new DataError(`${schema.label}: нет поля «${key}»`);
    args.push('$."' + key.replace(/"/g, '\\"') + '"');
    return 'json_extract(o.body, ?)';
}

function ftsQuery(text) {
    return String(text).trim().split(/\s+/).filter(Boolean).slice(0, 12)
        .map(w => '"' + w.replace(/"/g, '""') + '"*').join(' ');
}

/**
 * Выборка объектов класса (по умолчанию — с потомками).
 * @param {object} q
 * @param {string} q.cid Класс
 * @param {boolean} [q.deep=true] Включать объекты классов-потомков
 * @param {string|string[]} [q.status] Статусы (по умолчанию — все, кроме deleted)
 * @param {object} [q.where] { поле: значение | { eq|ne|gt|gte|lt|lte|in|contains: значение } }
 * @param {string} [q.search] Полнотекстовый поиск (префиксы слов)
 * @param {*} [q.from] Начало периода по дате объекта
 * @param {*} [q.to] Конец периода (день — включительно)
 * @param {string[]} [q.units] Только эти подразделения (видимость)
 * @param {string} [q.author] Только автор
 * @param {string} [q.ext_of] Записи-расширения объекта
 * @param {string} [q.order='-time'] Поле или колонка; «-» — по убыванию
 * @param {number} [q.limit=50]
 * @param {number} [q.offset=0]
 * @returns {{ total: number, items: object[] }}
 */
export function queryObjects(db, q) {
    const schema = classSchema(db, q.cid);
    if (!schema)
        throw new DataError(`класс ${q.cid} не найден`);
    const where = [];
    const args = [];
    if (q.deep === false) {
        where.push('o.cid = ?');
        args.push(schema.cid);
    }
    else {
        where.push('o.cid IN (SELECT descendant FROM class_tree WHERE ancestor = ?)');
        args.push(schema.cid);
    }
    const statuses = q.status === undefined ? null : [].concat(q.status);
    if (statuses) {
        where.push(`o.status IN (${statuses.map(() => '?').join(',')})`);
        args.push(...statuses);
    }
    else
        where.push(`o.status <> 'deleted'`);
    const [from, to] = periodRange(q.from, q.to);
    if (from > -Infinity) {
        where.push('o.time >= ?');
        args.push(from);
    }
    if (to < Infinity) {
        where.push('o.time < ?');
        args.push(to);
    }
    if (Array.isArray(q.units)) {
        where.push(q.units.length ? `o.unit IN (${q.units.map(() => '?').join(',')})` : '0');
        args.push(...q.units);
    }
    if (!isEmpty(q.author)) {
        where.push('o.author = ?');
        args.push(String(q.author));
    }
    if (!isEmpty(q.ext_of)) {
        where.push('o.ext_of = ?');
        args.push(String(q.ext_of));
    }
    if (!isEmpty(q.search)) {
        where.push('o.rowid IN (SELECT rowid FROM objects_fts WHERE objects_fts MATCH ?)');
        args.push(ftsQuery(q.search));
    }
    for (const [key, cond] of Object.entries(q.where || {})) {
        const c = cond !== null && typeof cond === 'object' && !Array.isArray(cond) ? cond : { eq: cond };
        for (const [op, value] of Object.entries(c)) {
            const col = columnExpr(db, schema, key, args);
            if (OPS[op]) {
                where.push(`${col} ${OPS[op]} ?`);
                args.push(value);
            }
            else if (op === 'in') {
                const list = [].concat(value);
                where.push(list.length ? `${col} IN (${list.map(() => '?').join(',')})` : '0');
                args.push(...list);
            }
            else if (op === 'contains') {
                where.push(`${col} LIKE ? ESCAPE '\\'`);
                args.push('%' + String(value).replace(/[\\%_]/g, m => '\\' + m) + '%');
            }
            else
                throw new DataError(`условие «${op}» не поддерживается (eq, ne, gt, gte, lt, lte, in, contains)`);
        }
    }
    const orderRaw = String(q.order || '-time');
    const desc = orderRaw.startsWith('-');
    const orderArgs = [];
    const orderCol = columnExpr(db, schema, desc ? orderRaw.slice(1) : orderRaw, orderArgs);
    const sqlWhere = where.join(' AND ');
    const total = db.prepare(`SELECT count(*) n FROM objects o WHERE ${sqlWhere}`).get(...args).n;
    const limit = Math.max(1, Math.min(MAX_LIMIT, Number(q.limit) || 50));
    const offset = Math.max(0, Number(q.offset) || 0);
    const rows = db.prepare(`${SELECT.replace('FROM objects', 'FROM objects o')} WHERE ${sqlWhere}
        ORDER BY ${orderCol} ${desc ? 'DESC' : 'ASC'}, o.id ${desc ? 'DESC' : 'ASC'} LIMIT ? OFFSET ?`)
        .all(...args, ...orderArgs, limit, offset);
    return { total, items: rows.map(r => toObject(r, classSchema(db, r.cid))) };
}
