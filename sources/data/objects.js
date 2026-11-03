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
import { objectCond } from './scope.js';

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
        case 'struct': {
            if (!value || typeof value !== 'object' || Array.isArray(value))
                return fail('ожидается вложенный объект (структура)');
            return checkBody(db, field.fields, value, errors, `${path}.`);
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
        const emptyStruct = f.type === 'struct' && v && typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length;
        if (isEmpty(v) || emptyStruct || (Array.isArray(v) && !v.length && f.type === 'table')) {
            if (f.required)
                errors.push({ field: prefix + f.id, message: 'обязательное поле' });
            continue;
        }
        const c = coerce(db, f, v, errors, prefix + f.id);
        if (c !== undefined && !(f.type === 'struct' && typeof c === 'object' && !Object.keys(c).length))
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
        if (f.type === 'struct' && v && typeof v === 'object')
            collectRefs(db, f.fields, v, prefix + f.id + '.', row, out);
        if (f.type === 'table' && Array.isArray(v))
            v.forEach((r, i) => collectRefs(db, f.fields, r, prefix + f.id + '.', row >= 0 ? row : i, out));
    }
    return out;
}

function searchText(schema, body, db = null) {
    const parts = [objectTitle(schema, body)];
    const walk = (fields, b) => {
        for (const f of fields || []) {
            const v = b?.[f.id];
            if (isEmpty(v))
                continue;
            if (['string', 'text', 'enum', 'number', 'money', 'integer', 'date', 'datetime', 'file'].includes(f.type)) {
                parts.push(String(v));
            }
            else if (f.type === 'link' && db) {
                try {
                    const refRow = db.prepare('SELECT cid, body FROM objects WHERE id = ?').get(String(v));
                    if (refRow) {
                        const refSchema = classSchema(db, refRow.cid);
                        const refBody = JSON.parse(refRow.body);
                        const refTitle = objectTitle(refSchema, refBody);
                        if (refTitle)
                            parts.push(String(refTitle));
                    }
                }
                catch { /* ignore */ }
            }
            if (f.type === 'struct' && v && typeof v === 'object')
                walk(f.fields, v);
            if (f.type === 'table' && Array.isArray(v))
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
    db.prepare('INSERT INTO objects_fts (rowid, text) VALUES (?, ?)').run(rowid, searchText(schema, body, db));
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
 * Вычислить следующий номер операции по настройке нумератора класса (schema.numerator).
 * По умолчанию счётчик обнуляется в начале каждого календарного года (reset: 'year').
 */
export function nextOperationNumber(db, schemaOrCid, time) {
    const schema = (schemaOrCid && typeof schemaOrCid === 'object') ? schemaOrCid : classSchema(db, schemaOrCid);
    if (!schema || schema.family !== 'operation' || !schema.numerator?.enabled || !schema.numerator?.field)
        return '';
    const numCfg = schema.numerator;
    const fieldId = numCfg.field;
    const ms = isEmpty(time) ? Date.now() : parseTime(time, 'дата объекта');
    const d = new Date(ms);
    const y = d.getFullYear();
    const m = d.getMonth();
    const day = d.getDate();

    let fromMs = null;
    let toMs = null;
    const reset = numCfg.reset || 'year';
    if (reset === 'year') {
        fromMs = new Date(y, 0, 1, 0, 0, 0, 0).getTime();
        toMs = new Date(y, 11, 31, 23, 59, 59, 999).getTime();
    }
    else if (reset === 'quarter') {
        const qStart = Math.floor(m / 3) * 3;
        fromMs = new Date(y, qStart, 1, 0, 0, 0, 0).getTime();
        toMs = new Date(y, qStart + 3, 0, 23, 59, 59, 999).getTime();
    }
    else if (reset === 'month') {
        fromMs = new Date(y, m, 1, 0, 0, 0, 0).getTime();
        toMs = new Date(y, m + 1, 0, 23, 59, 59, 999).getTime();
    }
    else if (reset === 'day') {
        fromMs = new Date(y, m, day, 0, 0, 0, 0).getTime();
        toMs = new Date(y, m, day, 23, 59, 59, 999).getTime();
    }

    const jsonPath = `$."${String(fieldId).replace(/"/g, '""')}"`;
    const rows = fromMs != null
        ? db.prepare(`SELECT json_extract(body, ?) AS val FROM objects WHERE cid = ? AND status <> 'deleted' AND ext_of IS NULL AND time >= ? AND time <= ?`).all(jsonPath, schema.cid, fromMs, toMs)
        : db.prepare(`SELECT json_extract(body, ?) AS val FROM objects WHERE cid = ? AND status <> 'deleted' AND ext_of IS NULL`).all(jsonPath, schema.cid);

    let maxNum = 0;
    for (const r of rows) {
        if (r?.val == null || r.val === '')
            continue;
        const s = String(r.val).trim();
        const match = /(\d+)\s*$/.exec(s);
        if (match) {
            const n = parseInt(match[1], 10);
            if (Number.isFinite(n) && n > maxNum)
                maxNum = n;
        }
    }
    const nextInt = maxNum + 1;
    const pad = Math.max(0, Number(numCfg.pad) || 0);
    const numStr = pad > 0 ? String(nextInt).padStart(pad, '0') : String(nextInt);
    const prefix = String(numCfg.prefix || '')
        .replace(/\{YYYY\}/g, String(y))
        .replace(/\{YY\}/g, String(y).slice(-2))
        .replace(/\{MM\}/g, String(m + 1).padStart(2, '0'));
    return prefix + numStr;
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
    let rawBody = p.body ?? {};
    if (schema.family === 'operation' && schema.numerator?.enabled && schema.numerator?.field && rawBody && typeof rawBody === 'object' && !Array.isArray(rawBody)) {
        const nf = schema.numerator.field;
        if (isEmpty(rawBody[nf])) {
            const autoNum = nextOperationNumber(db, schema, time);
            if (autoNum)
                rawBody = { ...rawBody, [nf]: autoNum };
        }
    }
    const body = validateBody(db, schema, rawBody);
    const validFrom = isEmpty(p.valid_from) ? (schema.family === 'catalog' ? 0 : now) : parseTime(p.valid_from, 'начало действия');
    const id = newId(now);
    tx(db, () => {
        db.prepare(`INSERT INTO objects (id, cid, status, time, author, place, unit, ext_of, version, created, updated, body)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`)
            .run(id, schema.cid, status, time, p.author ?? null, p.place ?? null, unit, extOf, now, now, JSON.stringify(body));
        db.prepare('INSERT INTO object_versions (id, version, valid_from, author, status, body) VALUES (?, 1, ?, ?, ?, ?)')
            .run(id, validFrom, p.author ?? null, status, JSON.stringify(body));
        writeDerived(db, schema, id, body);
        if (!isEmpty(p.basis_id)) {
            const srcId = String(p.basis_id).trim();
            if (srcId && srcId !== id) {
                db.prepare(`INSERT INTO doc_links (source_id, target_id, kind, note, author, created)
                    VALUES (?, ?, 'basis', ?, ?, ?)
                    ON CONFLICT(source_id, target_id) DO UPDATE SET note = excluded.note`)
                    .run(srcId, id, String(p.basis_note || ''), p.author ?? null, now);
            }
        }
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
export function writeVersion(db, id, { body, status, time, author, valid_from, version, system = false, force = false } = {}) {
    const cur = readObject(db, id);
    if (!cur)
        throw new DataError(`объект ${id} не найден`);
    const schema = classSchema(db, cur.cid);
    if (version !== undefined && version !== null && Number(version) !== cur.version)
        throw new DataError(`объект ${cur.title || id} уже изменён (версия ${cur.version}, а не ${version}) — обновите и повторите`);
    if (!system && schema.family === 'operation' && cur.status !== 'draft' && cur.status !== 'cancelled')
        throw new DataError(`операция «${cur.title || id}» зарегистрирована — изменить её можно только исправлением`);
    const nextStatus = status ?? (schema.family === 'operation' && cur.status === 'cancelled' ? 'draft' : cur.status);
    if (!STATUSES[schema.family].includes(nextStatus))
        throw new DataError(`статус «${nextStatus}» недопустим для ${schema.label}`);
    const nextBody = body === undefined ? cur.body : validateBody(db, schema, body);
    const nextTime = isEmpty(time) ? cur.time : parseTime(time, 'дата объекта');
    if (!force && nextStatus === cur.status && nextTime === cur.time && JSON.stringify(nextBody) === JSON.stringify(cur.body))
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
    if (schema.family === 'operation' && cur.status !== 'draft' && cur.status !== 'cancelled')
        throw new DataError(`операция «${cur.title || id}» зарегистрирована — удалить можно только черновик или отменённую операцию`);
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

/** Поля класса и его потомков (запрос к родителю фильтрует и по полям наследников, включая поля вложенных структур). */
function knownFields(db, schema) {
    const ids = new Set();
    const add = (list, prefix = '') => {
        for (const f of list) {
            ids.add(prefix + f.id);
            if (f.type === 'struct' && Array.isArray(f.fields))
                add(f.fields, prefix + f.id + '.');
        }
    };
    for (const cid of descendants(db, schema.cid)) {
        const s = classSchema(db, cid);
        add([...s.fields, ...s.overlay]);
    }
    return ids;
}

function columnExpr(db, schema, key, args) {
    if (COLUMNS.has(key))
        return `o.${key}`;
    if (!knownFields(db, schema).has(key))
        throw new DataError(`${schema.label}: нет поля «${key}»`);
    const jsonPath = '$.' + key.split('.').map(p => '"' + p.replace(/"/g, '\\"') + '"').join('.');
    args.push(jsonPath);
    return 'json_extract(o.body, ?)';
}

function ftsQuery(text) {
    return String(text).trim().split(/\s+/).filter(Boolean).slice(0, 12)
        .map(w => '"' + w.replace(/"/g, '""') + '"*').join(' ');
}

function sqlLowerCaseVariants(token) {
    const t = String(token || '').trim();
    if (!t)
        return [];
    const low = t.toLowerCase();
    const up = t.toUpperCase();
    const cap = low.charAt(0).toUpperCase() + low.slice(1);
    return [...new Set([t, low, up, cap])];
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
 * @param {string[]} [q.units] Только эти подразделения
 * @param {string} [q.unit] Подразделение с вложенными
 * @param {Array<object>|null} [q.visible] Права видимости (scope.js, scopeGrants): null — без ограничений
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
    if (!isEmpty(q.unit)) {
        const u = getClass(db, q.unit);
        if (!u || FAMILY[u.type] !== 'structure')
            throw new DataError(`подразделение ${q.unit} не найдено`);
        where.push('o.unit IN (SELECT descendant FROM class_tree WHERE ancestor = ?)');
        args.push(u.cid);
    }
    const visible = objectCond(q.visible);
    if (visible) {
        where.push(visible[0]);
        args.push(...visible[1]);
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
        const rawSearch = String(q.search).trim();
        const fts = ftsQuery(rawSearch);
        const tokens = rawSearch.split(/\s+/).filter(Boolean).slice(0, 8);
        const tokenConds = [];
        const likeArgs = [];
        for (const tok of tokens) {
            const variants = sqlLowerCaseVariants(tok);
            const subOr = [];
            for (const v of variants) {
                const pat = '%' + v.replace(/[\\%_]/g, m => '\\' + m) + '%';
                subOr.push(`o.body LIKE ? ESCAPE '\\'`);
                likeArgs.push(pat);
                subOr.push(`EXISTS (SELECT 1 FROM refs rf JOIN objects ro ON ro.id = rf.ref_id WHERE rf.obj_id = o.id AND ro.body LIKE ? ESCAPE '\\')`);
                likeArgs.push(pat);
            }
            subOr.push(`o.id LIKE ? ESCAPE '\\'`);
            likeArgs.push('%' + tok.replace(/[\\%_]/g, m => '\\' + m) + '%');
            tokenConds.push(`(${subOr.join(' OR ')})`);
        }
        const deepSql = tokenConds.length ? tokenConds.join(' AND ') : '0';
        if (fts) {
            where.push(`(o.rowid IN (SELECT rowid FROM objects_fts WHERE objects_fts MATCH ?) OR (${deepSql}))`);
            args.push(fts, ...likeArgs);
        }
        else if (tokenConds.length) {
            where.push(`(${deepSql})`);
            args.push(...likeArgs);
        }
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

/* ---------- подшивка документов (связи «Основание → Следствие» между операциями) ---------- */

function formatBinderItem(db, obj, direction, { note = '', viaRef = false } = {}) {
    if (!obj)
        return null;
    const cls = getClass(db, obj.cid);
    const b = obj.body || {};
    const num = String(b.num ?? b.doc_number ?? b.order_number ?? b.number ?? b.doc_num ?? '').trim();
    const sum = Number(b.sum ?? b.amount ?? b.total ?? 0) || 0;
    let party = String(b.recipient_name ?? b.payer_name ?? b.counterparty_name ?? '').trim();
    if (!party) {
        for (const k of ['recipient', 'payer', 'counterparty', 'client', 'supplier', 'customer', 'employee', 'person']) {
            if (b[k]) {
                const refObj = readObject(db, b[k]);
                if (refObj?.title) {
                    party = refObj.title;
                    break;
                }
            }
        }
    }
    return {
        id: obj.id,
        cid: obj.cid,
        path: cls?.path || obj.cid,
        classLabel: cls?.label || obj.cid,
        title: obj.title || cls?.label || obj.id,
        number: num,
        time: obj.time,
        date: localDay(obj.time),
        status: obj.status,
        sum,
        party,
        note: String(note || ''),
        viaRef: Boolean(viaRef),
        direction,
    };
}

/**
 * Получить подшивку операции `id`:
 * - `parents` — документы-основания (от которых произошла операция `id`),
 * - `children` — документы-следствия (созданные на основании операции `id`).
 */
export function getDocumentBinder(db, id) {
    const docId = String(id ?? '').trim();
    if (!docId)
        return { parents: [], children: [], total: 0 };
    const cur = readObject(db, docId);
    if (!cur)
        throw new DataError(`объект ${docId} не найден`);

    const parentMap = new Map();
    const childMap = new Map();

    // 1. Явные связи из таблицы doc_links
    const parentLinks = db.prepare('SELECT source_id, kind, note, created FROM doc_links WHERE target_id = ? ORDER BY created ASC').all(docId);
    for (const row of parentLinks) {
        const src = readObject(db, row.source_id);
        if (src && src.status !== 'deleted')
            parentMap.set(src.id, formatBinderItem(db, src, 'parent', { note: row.note, viaRef: false }));
    }

    const childLinks = db.prepare('SELECT target_id, kind, note, created FROM doc_links WHERE source_id = ? ORDER BY created ASC').all(docId);
    for (const row of childLinks) {
        const tgt = readObject(db, row.target_id);
        if (tgt && tgt.status !== 'deleted')
            childMap.set(tgt.id, formatBinderItem(db, tgt, 'child', { note: row.note, viaRef: false }));
    }

    // 2. Прямые ссылки между операциями через поля типа Link (таблица refs)
    const outRefs = db.prepare(`SELECT DISTINCT r.ref_id, r.field FROM refs r JOIN objects o ON o.id = r.ref_id
        WHERE r.obj_id = ? AND o.status <> 'deleted'`).all(docId);
    for (const r of outRefs) {
        if (parentMap.has(r.ref_id))
            continue;
        const refObj = readObject(db, r.ref_id);
        if (!refObj)
            continue;
        const refSchema = classSchema(db, refObj.cid);
        if (refSchema?.family === 'operation')
            parentMap.set(refObj.id, formatBinderItem(db, refObj, 'parent', { note: r.field, viaRef: true }));
    }

    const inRefs = db.prepare(`SELECT DISTINCT r.obj_id, r.field FROM refs r JOIN objects o ON o.id = r.obj_id
        WHERE r.ref_id = ? AND o.status <> 'deleted'`).all(docId);
    for (const r of inRefs) {
        if (childMap.has(r.obj_id))
            continue;
        const refObj = readObject(db, r.obj_id);
        if (!refObj)
            continue;
        const refSchema = classSchema(db, refObj.cid);
        if (refSchema?.family === 'operation')
            childMap.set(refObj.id, formatBinderItem(db, refObj, 'child', { note: r.field, viaRef: true }));
    }

    const parents = [...parentMap.values()].filter(Boolean).sort((a, b) => (a.time || 0) - (b.time || 0));
    const children = [...childMap.values()].filter(Boolean).sort((a, b) => (a.time || 0) - (b.time || 0));
    return {
        parents,
        children,
        total: parents.length + children.length,
    };
}

/** Связать две операции в подшивке (`sourceId` — основание, `targetId` — следствие). */
export function linkDocuments(db, { sourceId, targetId, kind = 'basis', note = '', author = null } = {}) {
    const srcId = String(sourceId ?? '').trim();
    const tgtId = String(targetId ?? '').trim();
    if (!srcId || !tgtId)
        throw new DataError('не указаны связываемые документы');
    if (srcId === tgtId)
        throw new DataError('нельзя подшить документ к самому себе');
    const src = readObject(db, srcId);
    const tgt = readObject(db, tgtId);
    if (!src || src.status === 'deleted')
        throw new DataError(`документ-основание ${srcId} не найден`);
    if (!tgt || tgt.status === 'deleted')
        throw new DataError(`документ-следствие ${tgtId} не найден`);
    tx(db, () => {
        // Если была обратная связь — удалим её, чтобы не образовывать петлю из 2 документов
        db.prepare('DELETE FROM doc_links WHERE source_id = ? AND target_id = ?').run(tgtId, srcId);
        db.prepare(`INSERT INTO doc_links (source_id, target_id, kind, note, author, created)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(source_id, target_id) DO UPDATE SET kind = excluded.kind, note = excluded.note`)
            .run(srcId, tgtId, String(kind || 'basis'), String(note || ''), author ?? null, Date.now());
    });
    return { ok: true };
}

/** Разорвать связь между двумя операциями в подшивке. */
export function unlinkDocuments(db, { id, targetId } = {}) {
    const a = String(id ?? '').trim();
    const b = String(targetId ?? '').trim();
    if (!a || !b)
        throw new DataError('не указаны документы для открепления');
    db.prepare('DELETE FROM doc_links WHERE (source_id = ? AND target_id = ?) OR (source_id = ? AND target_id = ?)').run(a, b, b, a);
    return { ok: true };
}

/**
 * Подобрать кандидатов-операций для подшивки к документу `id`:
 * в первую очередь показывает документы по тому же контрагенту/сотруднику, затем по поиску и дате.
 */
export function candidateBinderOperations(db, id, { search = '', samePartyOnly = false, limit = 50 } = {}) {
    const docId = String(id ?? '').trim();
    const cur = docId ? readObject(db, docId) : null;
    const opClasses = db.prepare("SELECT cid FROM classes WHERE type = '$operation'").all().map(r => r.cid);
    if (!opClasses.length)
        return { items: [], partyIds: [], partyName: '' };

    const existingIds = new Set([docId]);
    if (docId) {
        const binder = getDocumentBinder(db, docId);
        for (const p of binder.parents)
            existingIds.add(p.id);
        for (const c of binder.children)
            existingIds.add(c.id);
    }

    const partyIds = [];
    let partyName = '';
    if (cur) {
        const refs = db.prepare('SELECT DISTINCT ref_id FROM refs WHERE obj_id = ?').all(docId).map(r => r.ref_id);
        for (const rid of refs) {
            const ro = readObject(db, rid);
            if (ro && classSchema(db, ro.cid)?.family === 'catalog') {
                partyIds.push(rid);
                if (!partyName && ro.title)
                    partyName = ro.title;
            }
        }
        if (!partyName) {
            const b = cur.body || {};
            partyName = String(b.recipient_name ?? b.payer_name ?? b.counterparty_name ?? '').trim();
        }
    }

    const where = [
        `o.cid IN (${opClasses.map(() => '?').join(',')})`,
        `o.status <> 'deleted'`,
    ];
    const args = [...opClasses];
    if (docId) {
        where.push('o.id <> ?');
        args.push(docId);
    }

    if (samePartyOnly && partyIds.length) {
        where.push(`EXISTS (SELECT 1 FROM refs rf WHERE rf.obj_id = o.id AND rf.ref_id IN (${partyIds.map(() => '?').join(',')}))`);
        args.push(...partyIds);
    }

    const q = String(search ?? '').trim();
    if (q) {
        const tokens = q.split(/\s+/).filter(Boolean).slice(0, 6);
        for (const tok of tokens) {
            const variants = sqlLowerCaseVariants(tok);
            const sub = [];
            for (const v of variants) {
                const pat = '%' + v.replace(/[\\%_]/g, m => '\\' + m) + '%';
                sub.push(`o.body LIKE ? ESCAPE '\\'`);
                args.push(pat);
                sub.push(`EXISTS (SELECT 1 FROM refs rf JOIN objects ro ON ro.id = rf.ref_id WHERE rf.obj_id = o.id AND ro.body LIKE ? ESCAPE '\\')`);
                args.push(pat);
                sub.push(`EXISTS (SELECT 1 FROM classes cl WHERE cl.cid = o.cid AND cl.label LIKE ? ESCAPE '\\')`);
                args.push(pat);
            }
            where.push(`(${sub.join(' OR ')})`);
        }
    }

    const maxRows = Math.max(10, Math.min(200, Number(limit) || 50));
    let orderSql = 'o.time DESC, o.id DESC';
    const orderArgs = [];
    if (partyIds.length) {
        orderSql = `CASE WHEN EXISTS (SELECT 1 FROM refs rf WHERE rf.obj_id = o.id AND rf.ref_id IN (${partyIds.map(() => '?').join(',')})) THEN 0 ELSE 1 END ASC, ABS(o.time - ?) ASC, o.time DESC`;
        orderArgs.push(...partyIds, cur?.time || Date.now());
    }
    else if (cur?.time) {
        orderSql = `ABS(o.time - ?) ASC, o.time DESC`;
        orderArgs.push(cur.time);
    }

    const rows = db.prepare(`${SELECT.replace('FROM objects', 'FROM objects o')} WHERE ${where.join(' AND ')} ORDER BY ${orderSql} LIMIT ?`)
        .all(...args, ...orderArgs, maxRows);

    const items = [];
    for (const r of rows) {
        if (existingIds.has(r.id))
            continue;
        const obj = toObject(r, classSchema(db, r.cid));
        const formatted = formatBinderItem(db, obj, 'candidate');
        if (formatted) {
            formatted.sameParty = partyIds.length > 0 && db.prepare(`SELECT 1 FROM refs WHERE obj_id = ? AND ref_id IN (${partyIds.map(() => '?').join(',')}) LIMIT 1`).get(r.id, ...partyIds) != null;
            items.push(formatted);
        }
    }
    return { items, partyIds, partyName };
}
