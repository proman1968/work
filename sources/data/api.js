/**
 * Методы учётного ядра у классов дерева (`$class`): объекты, проведение, отчёты, выбор ссылки.
 *
 * Метод вызывается на классе, к которому относится запрос: создание — на листе
 * справочника или операции, выборка — на классе с потомками, отчёты — на счёте
 * (или журнале), состав — на виртуальном справочнике. Права — правила этого класса:
 * чтение — `assertAccess(read)` и видимость данных по `scope` ссылок рабочих мест (scope.js):
 * ссылка на класс или его предка — поддерево класса, ссылка ниже — только её ветка (сводный
 * отчёт предка), строки — по подразделению, месту или автору; назначение в самом классе,
 * системная сессия, DEV, админ WORK и класс с GUEST — всё. Запись — `_assertDataWrite`
 * (автор — субъект сессии) и права ссылок на запись; подразделение и место создаваемого
 * объекта — из мест записи пользователя. Закрытие периода — ADMIN. Объект по `id` доступен
 * только в поддереве класса вызова и в его видимости; чтение через виртуальный справочник
 * видит объекты его реестра (на них ссылаются его поля).
 *
 * Кэш классов в БД обновляется перед первым обращением и после правок class.js
 * (`markClassesDirty` — из save_file и наблюдателя за диском); неизвестный класс
 * под корнями данных обновляет кэш ещё раз (класс только что создан).
 *
 * Параметры HTTP приходят строками: флаги ('true'/'1'), JSON-объекты и списки
 * (`where`, `analytics`, `units`, `status`, `by`) разбираются здесь; тело — `post` или `body`.
 */
import fs from 'node:fs';
import { DEV_MODE } from '../host/config.js';
import { dataDb, baseDbFile, dataGeneration } from './db.js';
import { refreshClasses, getClass, descendants, isLeaf, classesOfType, classesGeneration, DEFAULT_ROOTS, STRUCTURE_TYPES, clearScanCache } from './classes.js';
import { classSchema, checkSchema, analyticSlots, FAMILY } from './schema.js';
import {
    createObject, readObject, objectVersions, updateObject, deleteObject, restoreObject, queryObjects, linkCids,
} from './objects.js';
import {
    registerOperation, correctOperation, cancelOperation, previewEntries, operationEntries, closePeriod, closedUntil,
} from './posting.js';
import {
    journal, trialBalance, accountCard, accountTurnovers, readEntry, objectState, objectTrajectory, virtualMembers, countVirtualMembers, isVirtualMember, namesOf,
} from './reports.js';
import { linkChoices } from './choices.js';
import { printTemplates, renderPrint } from './print.js';
import {
    scopeGrants, entryGrants, withoutBranches, objectCond, visibleUnits, writeContexts, resolvePlace,
} from './scope.js';
import { DataError } from './errors.js';
import { localDay } from './time.js';
import { buildWorkspace } from './workspace.js';
import { normalizeSecurity, walkPlaces, trailKey } from '../server/access/workplaces.js';

/** Ссылки рабочих мест — модулем по требованию: links.js тянет сервер, который сам импортирует этот модуль. */
const linksModule = () => import('../server/access/links.js');

const storeStates = new Map();
let dirtyGeneration = 1;

/** Путь организации ($base) для вызова: из параметра `base` или из пути элемента `/ORGANIZATIONS/<Имя>`. */
export function resolveBasePath(item, p = {}) {
    if (typeof p?.base === 'string' && p.base.trim())
        return '/' + p.base.trim().replace(/^\/+|\/+$/g, '');
    const raw = typeof item === 'string' ? item : String(item?.path ?? '');
    const m = raw.match(/^\/(ORGANIZATIONS|BASES)\/([^/]+)/);
    return m ? `/${m[1]}/${m[2]}` : '';
}

function rootsForBase(basePath) {
    if (!basePath)
        return DEFAULT_ROOTS;
    return ['MODULES', 'DATA', basePath.replace(/^\/+/, '')];
}

/** Кэш классов устарел (правка class.js): обновится перед следующим обращением. */
export function markClassesDirty() {
    dirtyGeneration++;
    clearScanCache();
}

/** БД данных организации ($base) с актуальным кэшем классов. */
export async function dataStore(basePath = '') {
    const key = String(basePath ?? '').trim().replace(/\/+$/, '');
    const db = await dataDb(key);
    let st = storeStates.get(db);
    if (!st) {
        st = { gen: 0, refreshing: null };
        storeStates.set(db, st);
    }
    while (st.gen < dirtyGeneration || st.refreshing) {
        if (!st.refreshing) {
            const targetGen = dirtyGeneration;
            st.refreshing = refreshClasses(db, process.cwd(), rootsForBase(key))
                .then(r => {
                    st.gen = targetGen;
                    if (r.problems.length)
                        console.warn('[data] классы:', r.problems.join('; '));
                })
                .finally(() => {
                    st.refreshing = null;
                });
        }
        await st.refreshing;
    }
    return db;
}

/** Есть ли у класса ядра собственные неудалённые объекты (инвариант листа при создании дочернего класса). */
export async function classHasObjects(ref) {
    const pathStr = String(ref ?? '');
    const db = await dataStore(resolveBasePath(pathStr));
    const cls = getClass(db, pathStr);
    return !!cls && !!db.prepare("SELECT 1 FROM objects WHERE cid = ? AND status <> 'deleted' LIMIT 1").get(cls.cid);
}

const COUNTABLE_DATA_TYPES = new Set(['$catalog', '$virtual', '$operation', '$account', '$register']);
const dbSummaryCache = new WeakMap();
const baseDbExistsCache = new Map();

/**
 * Кэш сводных счётчиков объектов/записей счетов и дат операций по БД.
 * Автоматически сбрасывается при любом изменении классов (`classesGeneration`) или данных (`dataGeneration`).
 */
function getDbSummary(db) {
    const clsGen = classesGeneration(db);
    const dataGen = dataGeneration(db);
    let summary = dbSummaryCache.get(db);
    if (summary && summary.clsGen === clsGen && summary.dataGen === dataGen)
        return summary;

    const ownObjCounts = new Map();
    for (const r of db.prepare("SELECT cid, count(*) n FROM objects WHERE status <> 'deleted' AND ext_of IS NULL GROUP BY cid").all())
        ownObjCounts.set(r.cid, Number(r.n) || 0);

    const ownAccCounts = new Map();
    for (const r of db.prepare('SELECT account_cid cid, count(*) n FROM account_entries WHERE NOT storno GROUP BY account_cid').all())
        ownAccCounts.set(r.cid, Number(r.n) || 0);

    const subtreeCounts = new Map();
    const opDaysByCid = new Map();

    summary = {
        clsGen,
        dataGen,
        ownObjCounts,
        ownAccCounts,
        subtreeCounts,
        opDaysByCid,
        countFor(clsPath, clsType = '') {
            const cls = getClass(db, clsPath);
            const type = cls?.type || clsType;
            if (!type || type === '$base' || type === '$structure' || type === '$domain')
                return 0;
            const key = `${type}:${cls?.cid || clsPath}`;
            if (subtreeCounts.has(key))
                return subtreeCounts.get(key);
            let total = 0;
            if (type === '$virtual') {
                total = countVirtualMembers(db, cls?.cid || clsPath);
            }
            else if (type === '$account' || type === '$register') {
                const accs = cls ? descendants(db, cls.cid) : [clsPath];
                for (const cid of accs)
                    total += ownAccCounts.get(cid) || 0;
            }
            else if (type === '$catalog' || type === '$operation') {
                const cids = cls ? descendants(db, cls.cid) : [clsPath];
                for (const cid of cids) {
                    if (getClass(db, cid)?.type !== '$virtual')
                        total += ownObjCounts.get(cid) || 0;
                }
            }
            subtreeCounts.set(key, total);
            return total;
        },
        opDaysFor(cid, desc) {
            if (opDaysByCid.has(cid))
                return opDaysByCid.get(cid);
            const daySet = new Set();
            if (desc.length) {
                for (const r of db.prepare(`SELECT DISTINCT time FROM objects WHERE cid IN (${desc.map(() => '?').join(',')}) AND status <> 'deleted' AND ext_of IS NULL AND time IS NOT NULL ORDER BY time`).all(...desc)) {
                    if (Number.isFinite(r.time))
                        daySet.add(localDay(r.time));
                }
            }
            const days = [...daySet].sort();
            opDaysByCid.set(cid, days);
            return days;
        },
    };
    dbSummaryCache.set(db, summary);
    return summary;
}

/**
 * Количество объектов (или записей счёта/участников виртуального справочника) у класса и его поддерева.
 * Если файла БД организации ещё нет на диске — возвращает 0 без создания файла БД.
 */
export async function classObjectCount(clsPath, clsType = '') {
    if (clsType && !COUNTABLE_DATA_TYPES.has(clsType))
        return 0;
    const p = String(clsPath ?? '').trim();
    if (!p || p === '/' || p.startsWith('/MODULES/'))
        return 0;
    const basePath = resolveBasePath(p);
    const dbFile = baseDbFile(process.cwd(), basePath);
    const now = Date.now();
    let entry = baseDbExistsCache.get(dbFile);
    if (!entry || now - entry.ts > 1000) {
        entry = { ok: fs.existsSync(dbFile), ts: now };
        baseDbExistsCache.set(dbFile, entry);
    }
    if (!entry.ok)
        return 0;
    try {
        const db = await dataStore(basePath);
        return getDbSummary(db).countFor(p, clsType);
    }
    catch {
        return 0;
    }
}

/* ---------- параметры ---------- */

const isEmpty = v => v === undefined || v === null || v === '';
const flag = v => v === true || v === 1 || v === '1' || v === 'true';
const optFlag = v => (isEmpty(v) ? undefined : flag(v));

/** JSON-строка объекта или списка — разобрать, иначе как есть. */
function json(v, what) {
    if (typeof v !== 'string' || !/^\s*[[{]/.test(v))
        return v;
    try {
        return JSON.parse(v);
    }
    catch {
        throw new DataError(`${what}: неверный JSON`);
    }
}

function list(v, what) {
    const x = json(v, what);
    return isEmpty(x) ? undefined : [].concat(x);
}

/** Тело запроса: объект, JSON-строка или Buffer. */
function bodyOf(p) {
    let v = p.post ?? p.body;
    if (Buffer.isBuffer(v))
        v = v.toString('utf-8');
    if (isEmpty(v))
        return undefined;
    v = json(v, 'тело');
    if (!v || typeof v !== 'object' || Array.isArray(v))
        throw new DataError('тело — JSON-объект');
    return v;
}

/** Общие фильтры проводок отчётов. */
function entryFilters(p) {
    return {
        units: list(p.units, 'units'),
        unit: p.unit,
        op_cid: p.op_cid,
        op: p.op,
        author: p.author,
        place: p.place,
    };
}

/* ---------- класс вызова и права ---------- */

const underData = path => DEFAULT_ROOTS.some(r => path === '/' + r || path.startsWith('/' + r + '/'));

async function classOf(db, item, basePath = '') {
    const ref = String(item?.path ?? '');
    let cls = getClass(db, ref);
    if (!cls && underData(ref)) {
        markClassesDirty();
        await dataStore(basePath);
        cls = getClass(db, ref);
    }
    if (!cls)
        throw new DataError(`${ref || 'элемент'} — не класс учётного ядра`);
    return cls;
}

function inside(db, cls, ref, what) {
    const c = getClass(db, ref);
    if (!c || !descendants(db, cls.cid).includes(c.cid))
        throw new DataError(`${what} ${ref} не найден в «${cls.label}»`);
    return c.cid;
}

/** Объект поддерева класса вызова в видимости вызова (для записи и проведения — права записи). */
function ownObject(db, cls, id, vis) {
    return objectIn(db, cls, id, descendants(db, cls.cid), vis);
}

/**
 * Объект, видимый через класс: поддерево класса. У виртуального справочника — объект его
 * реестра (на них ссылаются его поля): видимый в самом реестре или участник видимого состава.
 */
async function visibleObject(db, cls, id, vis, p) {
    const registry = linkCids(db, cls.cid);
    if (!registry)
        return objectIn(db, cls, id, descendants(db, cls.cid), vis);
    try {
        return objectIn(db, cls, id, registry, await registryGrants(db, cls, vis, p));
    }
    catch (e) {
        if (!isEmpty(id) && objectIn(db, cls, id, registry, null)
            && isVirtualMember(db, cls.cid, String(id), undefined, entryGrants(withoutBranches(vis), 'catalog')))
            return String(id);
        throw e;
    }
}

/**
 * Права на объекты реестра-источника виртуального справочника: состав «Клиентов» ограничен
 * видимостью справочника, а поиск по реестру (новый покупатель) и чтение его объектов — видимостью
 * реестра для того же пользователя. Состав виден целиком — реестр тоже (как до scope).
 */
async function registryGrants(db, cls, vis, p) {
    if (vis === null)
        return null;
    const reg = getClass(db, classSchema(db, cls.cid)?.source?.registry);
    let item = reg ? await globalThis.WORK?.get_item(reg.path).catch(() => null) : null;
    if (Array.isArray(item))
        item = item.at(-1);
    if (!item?.assertAccess)
        return [];
    await item.init;
    return (await scopeOf(item, p, db, reg, false)).grants;
}

function objectIn(db, cls, id, cids, vis) {
    const row = isEmpty(id) ? null : db.prepare('SELECT cid FROM objects WHERE id = ?').get(String(id));
    let ok = !!row && cids.includes(row.cid);
    const cond = ok ? objectCond(vis) : null;
    if (cond)
        ok = !!db.prepare(`SELECT 1 FROM objects o WHERE o.id = ? AND ${cond[0]}`).get(String(id), ...cond[1]);
    if (!ok)
        throw new DataError(`объект ${id ?? ''} не найден в «${cls.label}»`);
    return String(id);
}

/** Права на проводки отчёта об объекте: ветки, в которые входит объект (у виртуального — его реестр). */
function objectEntryGrants(db, cls, id, vis) {
    if (linkCids(db, cls.cid))
        return entryGrants(withoutBranches(vis), 'catalog');
    return entryGrants(vis, familyOf(cls), db.prepare('SELECT cid FROM objects WHERE id = ?').get(id)?.cid);
}

/** Названия объектов, на которые ссылаются найденные объекты (поля-ссылки и табличные части). */
function linkNames(db, ids) {
    const refs = [];
    for (let i = 0; i < ids.length; i += 500) {
        const chunk = ids.slice(i, i + 500);
        refs.push(...db.prepare(`SELECT DISTINCT ref_id FROM refs WHERE obj_id IN (${chunk.map(() => '?').join(',')})`)
            .all(...chunk).map(r => r.ref_id));
    }
    return namesOf(db, refs).objects;
}

function familyOf(cls) {
    return FAMILY[cls.type] || 'other';
}

/** Счёт отчёта: параметр внутри класса-счёта (журнала) вызова или сам класс. */
function reportAccount(db, cls, ref) {
    if (familyOf(cls) !== 'account')
        throw new DataError(`«${cls.label}» — не счёт и не журнал`);
    return isEmpty(ref) ? cls.cid : inside(db, cls, ref, 'счёт');
}

/**
 * Данные класса видны целиком, без scope ссылок: вызов без сессии, системная сессия, DEV,
 * админ WORK, назначение в самом классе (роль #security, системные — и сверху); для чтения —
 * и класс, открытый гостям. Для записи назначение должно давать запись.
 */
async function fullAccess(item, p, write) {
    if (!p?.session || DEV_MODE || p.session.$user === globalThis.WORK)
        return true;
    if (!write && item.DATA?.['#security']?.USER?.includes('GUEST'))
        return true;
    if (await item._isWorkAdmin(p).catch(() => false))
        return true;
    const level = await (await linksModule()).directAccess(item, p).catch(() => null);
    return write ? level === 'write' || level === 'admin' : level != null;
}

/**
 * Видимость вызова: { full, links — ссылки рабочих мест пользователя на класс, его предков
 * и поддерево, grants — права (null — всё, [] — ничего) }. Для записи — только ссылки на запись.
 */
async function scopeOf(item, p, db, cls, write) {
    const full = await fullAccess(item, p, write);
    const uid = item.constructor.resolveUid?.(p);
    const links = uid ? await (await linksModule()).scopeLinks(item, p).catch(() => []) : [];
    return { full, links, grants: full ? null : scopeGrants(db, cls, links, { uid, write }) };
}

const admin = async (item, p) => item.assertAccess(p, item.constructor.ACCESS_LEVEL.ADMIN);

/**
 * Обёртка метода: права, БД, класс вызова, видимость (`vis` — права scope.js).
 * Чтение: страница класса видна (предок ссылки — как каркас цепочки) и есть хоть одна видимая
 * ветка: ссылка на класс, его предка или ниже.
 */
function method(level, fn) {
    return async (item, p = {}) => {
        if (typeof item?.isModuleBlocked === 'function' && await item.isModuleBlocked())
            throw new DataError('Модуль заблокирован', [], 403);
        let uid = null;
        if (level === 'read')
            await item.assertAccess(p, item.constructor.ACCESS_LEVEL.READ);
        else if (level === 'write')
            uid = await item._assertDataWrite(p);
        else
            await admin(item, p);
        const basePath = resolveBasePath(item, p);
        const db = await dataStore(basePath);
        const cls = await classOf(db, item, basePath);
        const scope = level === 'admin'
            ? { full: true, links: [], grants: null }
            : await scopeOf(item, p, db, cls, level === 'write');
        if (scope.grants?.length === 0)
            throw new Error('Доступ запрещён');
        return fn({ db, cls, item, p, uid, scope, vis: scope.grants });
    };
}

/**
 * Записать факт операции в ленту событий (data.logs) подразделения (или класса операции) и автора.
 */
async function logOperationFact(db, item, op, action, uid, p) {
    if (!op || !globalThis.WORK)
        return;
    try {
        const LOGS = await import('../server/logs.js');
        let storage = item;
        const unitPath = op.unit || p?.unit;
        if (unitPath) {
            let u = await globalThis.WORK.get_item(unitPath).catch(() => null);
            if (Array.isArray(u))
                u = u.at(-1);
            if (u?.save_file)
                storage = u;
        }
        if (!storage?.save_file)
            return;
        const cls = getClass(db, op.cid);
        const title = op.title || op.name || cls?.label || op.id;
        const senderUid = uid || op.author || p?.uid || 'system';
        const row = {
            time: Date.now(),
            sender: senderUid,
            ext: cls?.type === '$catalog' ? 'object' : 'operation',
            path: `${op.cid}/${op.id}`,
            classPath: cls?.path || op.cid,
            objectId: op.id,
            unit: unitPath || '',
            content: `${action}: ${cls?.label && cls.label !== title ? cls.label + ' — ' : ''}${title}`,
        };
        await LOGS.appendRow(storage, row, { ...p, uid: senderUid });
    }
    catch {
        /* логи не должны блокировать транзакцию БД */
    }
}

/**
 * Схема для форм: у полей-ссылок (и в строках табличных частей, и в расширениях) к `target` (cid)
 * добавлен `targetPath` — форма и поле-ссылка открывают класс по пути дерева (`WORK.get_item`), а не по cid.
 */
function withTargetPaths(db, schema) {
    if (!schema)
        return schema;
    const walk = list => (list || []).map(f => ({
        ...f,
        ...(f.type === 'link' && f.target ? { targetPath: getClass(db, f.target)?.path ?? f.target } : {}),
        ...(f.type === 'table' || f.type === 'struct' ? { fields: walk(f.fields) } : {}),
    }));
    return { ...schema, fields: walk(schema.fields), overlay: walk(schema.overlay) };
}

/**
 * Собрать аналитические признаки по полям прилинкованного справочника слота счёта
 * (Наименование + поля схемы $catalog, вложенных структур $struct и расширений OVERLAY у $virtual)
 * со списком реально существующих значений для панели «Анализ счёта».
 */
function buildCatalogAnalyticFields(db, slotField) {
    const slotId = slotField.id;
    const slotLabel = slotField.label || slotId;
    const targetPath = slotField.targetPath || slotField.target;
    const targetSchema = slotField.target ? withTargetPaths(db, classSchema(db, slotField.target)) : null;
    if (!targetSchema) {
        return [{
            id: slotId,
            spec: slotId,
            slotId,
            fieldId: 'name',
            label: 'Наименование',
            slotLabel,
            isObject: true,
            type: 'link',
            catalog: targetPath,
            options: [],
        }];
    }
    const isVirt = targetSchema.type === '$virtual';
    const regCid = isVirt ? (targetSchema.source?.registry || targetSchema.cid) : targetSchema.cid;
    const descCids = descendants(db, regCid);

    let objRows = [];
    if (descCids.length) {
        objRows = db.prepare(
            `SELECT id, cid, body FROM objects WHERE cid IN (${descCids.map(() => '?').join(',')}) AND status <> 'deleted' AND ext_of IS NULL ORDER BY updated DESC LIMIT 300`
        ).all(...descCids);
    }
    const extByObj = new Map();
    if (isVirt) {
        const virtCids = descendants(db, targetSchema.cid);
        if (virtCids.length) {
            for (const r of db.prepare(
                `SELECT ext_of, body FROM objects WHERE cid IN (${virtCids.map(() => '?').join(',')}) AND status <> 'deleted' AND ext_of IS NOT NULL LIMIT 300`
            ).all(...virtCids)) {
                try {
                    extByObj.set(r.ext_of, JSON.parse(r.body || '{}'));
                }
                catch { /* ignore */ }
            }
        }
    }

    const parsedObjs = objRows.map(r => {
        let body = {};
        try { body = JSON.parse(r.body || '{}'); } catch { /* ignore */ }
        const title = String(body.name || body.label || body.title || r.id).trim();
        return { id: r.id, title, body, ext: extByObj.get(r.id) || null };
    });

    const objectOptions = parsedObjs
        .map(o => ({ value: o.id, label: o.title || o.id }))
        .sort((a, b) => a.label.localeCompare(b.label, 'ru', { numeric: true }));

    const fieldDefs = [];
    const seenFieldIds = new Set(['name', 'time']);
    const collectFields = (list, isOverlay = false, prefix = '', prefixLabel = '') => {
        for (const f of list || []) {
            if (!f?.id || f.type === 'table')
                continue;
            const fullId = prefix ? `${prefix}.${f.id}` : f.id;
            const fullLabel = prefixLabel ? `${prefixLabel}: ${f.label || f.id}` : (f.label || f.id);
            if (f.type === 'struct' && Array.isArray(f.fields) && f.fields.length) {
                collectFields(f.fields, isOverlay, fullId, fullLabel);
                continue;
            }
            if (seenFieldIds.has(fullId))
                continue;
            seenFieldIds.add(fullId);
            fieldDefs.push({
                fieldId: fullId,
                label: fullLabel,
                type: f.type || 'string',
                target: f.target,
                values: f.values || f.options,
                isOverlay,
            });
        }
    };

    collectFields(targetSchema.fields, false);
    if (isVirt)
        collectFields(targetSchema.overlay, true);
    for (const cid of descCids) {
        if (cid === targetSchema.cid)
            continue;
        const cs = classSchema(db, cid);
        if (cs)
            collectFields(cs.fields, false);
    }

    const refIdsToResolve = new Set();
    const rawValuesByField = new Map();
    for (const fd of fieldDefs) {
        const vals = new Set();
        for (const o of parsedObjs) {
            let v;
            if (fd.isOverlay && o.ext) {
                v = o.ext[fd.fieldId];
            }
            else {
                let cur = o.body;
                for (const part of fd.fieldId.split('.')) {
                    if (!cur || typeof cur !== 'object') { cur = undefined; break; }
                    cur = cur[part];
                }
                v = cur;
            }
            if (v === undefined || v === null || v === '' || typeof v === 'object')
                continue;
            const strVal = String(v).trim();
            if (!strVal)
                continue;
            vals.add(strVal);
            if (fd.type === 'link')
                refIdsToResolve.add(strVal);
        }
        rawValuesByField.set(fd.fieldId, [...vals]);
    }

    const refNames = refIdsToResolve.size ? namesOf(db, [...refIdsToResolve]).objects : {};

    const out = [{
        id: slotId,
        spec: slotId,
        slotId,
        fieldId: 'name',
        label: 'Наименование',
        slotLabel,
        isObject: true,
        type: 'link',
        catalog: targetPath,
        options: objectOptions,
    }];

    for (const fd of fieldDefs) {
        const rawVals = rawValuesByField.get(fd.fieldId) || [];
        let options = [];
        if (fd.type === 'boolean') {
            options = [{ value: '1', label: 'Да' }, { value: '0', label: 'Нет' }];
        }
        else if (fd.type === 'enum' && Array.isArray(fd.values) && fd.values.length) {
            options = fd.values.map(v => (v && typeof v === 'object'
                ? { value: String(v.id ?? v.value), label: String(v.label ?? v.id ?? v.value) }
                : { value: String(v), label: String(v) }));
        }
        else {
            options = rawVals.map(v => ({
                value: v,
                label: fd.type === 'link' ? (refNames[v] || v) : v,
            })).sort((a, b) => a.label.localeCompare(b.label, 'ru', { numeric: true }));
        }
        out.push({
            id: `${slotId}.${fd.fieldId}`,
            spec: `${slotId}.${fd.fieldId}`,
            slotId,
            fieldId: fd.fieldId,
            label: fd.label,
            slotLabel,
            isObject: false,
            type: fd.type,
            options,
        });
    }
    return out;
}

/**
 * Поддерево класса для форм: `classes` (cid → описание потомков), `leaves` (листья для создания
 * объектов в группе) и `slots` (слоты аналитик счёта или журнала по всему поддереву счетов).
 */
function schemaSubtree(db, cls) {
    const classes = {};
    const leaves = [];
    const slots = [];
    const seenSlots = new Set();
    const fam = familyOf(cls);
    const desc = descendants(db, cls.cid);
    const summary = (desc.length && (fam === 'catalog' || fam === 'operation')) ? getDbSummary(db) : null;
    for (const cid of desc) {
        const c = getClass(db, cid);
        if (!c)
            continue;
        const leaf = isLeaf(db, cid);
        const count = summary ? (summary.ownObjCounts.get(cid) || 0) : 0;
        classes[cid] = {
            cid,
            path: c.path,
            parent: c.parent || '',
            label: c.label,
            type: c.type,
            icon: c.own?.icon || '',
            leaf,
            count,
        };
        if (leaf && ['$catalog', '$registry', '$operation'].includes(c.type))
            leaves.push({ cid, path: c.path, label: c.label, count });
        if (fam === 'account') {
            const s = withTargetPaths(db, classSchema(db, cid));
            for (const f of analyticSlots(s || { fields: [] })) {
                if (!seenSlots.has(f.id)) {
                    seenSlots.add(f.id);
                    slots.push({
                        id: f.id,
                        label: f.label || f.id,
                        target: f.target,
                        targetPath: f.targetPath || f.target,
                        fields: buildCatalogAnalyticFields(db, f),
                    });
                }
            }
        }
    }
    const rootModPath = cls.path.replace(/^\/(ORGANIZATIONS|BASES)\/[^/]+/, '');
    const defaultIcon = cls.own?.icon
        || (rootModPath !== cls.path ? getClass(db, rootModPath)?.own?.icon : '')
        || (fam === 'operation' ? 'carbon:task-complete' : 'carbon:catalog');
    for (const c of Object.values(classes)) {
        const parts = [];
        let cur = c;
        let icon = c.icon;
        const seen = new Set();
        while (cur && cur.cid !== cls.cid && !seen.has(cur.cid)) {
            seen.add(cur.cid);
            parts.unshift(cur.label || cur.cid.split('/').pop());
            cur = cur.parent ? classes[cur.parent] : null;
            if (!icon && cur?.icon)
                icon = cur.icon;
        }
        c.icon = icon || defaultIcon;
        c.group = parts.join('/');
    }
    leaves.sort((a, b) => a.label.localeCompare(b.label, 'ru'));
    const opDays = (desc.length && fam === 'operation' && summary)
        ? summary.opDaysFor(cls.cid, desc)
        : undefined;
    return { classes, leaves, ...(fam === 'account' ? { slots } : {}), ...(opDays ? { days: opDays } : {}) };
}

/** Пути мест подразделения (дерево ROLES его #security). */
async function structurePlaces(path) {
    if (!path)
        return [];
    let g = await globalThis.WORK?.get_item(path).catch(() => null);
    if (Array.isArray(g))
        g = g.at(-1);
    await g?.init;
    return walkPlaces(normalizeSecurity(g?.DATA?.['#security']).places).map(({ trail }) => trailKey(trail));
}

/** Подразделение и место создаваемого объекта: указанные клиентом (проверка) или единственные доступные. */
async function writePlace(db, cls, p, scope) {
    const known = isEmpty(p.unit) || isEmpty(p.place) ? null : await structurePlaces(getClass(db, p.unit)?.path);
    return resolvePlace(db, writeContexts(db, cls, scope.links), { unit: p.unit, place: p.place }, { full: scope.full, known });
}

/* ---------- методы ---------- */

function buildScopeInfo(db, cls, scope) {
    return {
        all: scope.grants === null,
        units: (visibleUnits(scope.grants) ?? classesOfType(db, STRUCTURE_TYPES).map(c => c.cid)).map(cid => {
            const c = getClass(db, cid);
            return { cid, path: c?.path ?? cid, label: c?.label ?? cid };
        }),
        contexts: writeContexts(db, cls, scope.links),
    };
}

/**
 * Методы ядра: имя → { level — уровень шлюза (access/gateway.js), fn(item, params) }.
 * Устанавливаются в прототип `$class` (sources/server/class.js).
 */
export const DATA_METHODS = Object.freeze({
    /**
     * Схема класса по наследованию и ошибки конфигурации: { schema, errors }.
     * Схема вложена: ответ с `type`/`path` на верхнем уровне клиент (WORK.__bind) превратил бы в элемент дерева.
     */
    db_schema: { level: 'read', fn: method('read', ({ db, cls, p, scope }) => ({
        schema: withTargetPaths(db, classSchema(db, cls.cid)),
        errors: checkSchema(db, cls.cid),
        ...schemaSubtree(db, cls),
        ...(flag(p?.withScope) ? { scope: buildScopeInfo(db, cls, scope) } : {}),
    })) },

    /**
     * Видимость и места записи пользователя в классе: { all, units, contexts }.
     * all — видны все данные; units — подразделения для фильтра отчётов и выборок
     * ({ cid, path, label }; при all — все подразделения); contexts — подразделения и места,
     * от которых можно создать объект ({ unit, unit_label, place, place_label, any? }).
     */
    db_scope: { level: 'read', fn: method('read', ({ db, cls, scope }) => buildScopeInfo(db, cls, scope)) },

    /**
     * Рабочее пространство пользователя в подразделении вызова и вложенных: подразделения и места
     * с меню (ссылки мест на классы), контексты работы и описание классов меню — см. workspace.js.
     * Вызывается на подразделении (`$structure`, `$base`); права — чтение подразделения.
     */
    db_workspace: { level: 'read', fn: async (item, p = {}) => {
        const basePath = resolveBasePath(item, p);
        const db = await dataStore(basePath);
        const root = await classOf(db, item, basePath);
        if (!STRUCTURE_TYPES.includes(root.type))
            throw new DataError(`«${root.label}» — не подразделение`);
        const units = [];
        for (const cid of descendants(db, root.cid)) {
            const c = getClass(db, cid);
            if (!STRUCTURE_TYPES.includes(c.type))
                continue;
            let g = await globalThis.WORK.get_item(c.path);
            if (Array.isArray(g))
                g = g.at(-1);
            await g?.init;
            const roles = await g?.roles(p).catch(() => []) ?? [];
            const admin = DEV_MODE || p.session?.$user === globalThis.WORK || roles.includes('ADMIN')
                || await g?._isWorkAdmin(p).catch(() => false) || false;
            units.push({ ...c, parent: c.cid === root.cid ? null : c.parent, roles, admin, security: g?.DATA?.['#security'] });
        }
        return buildWorkspace(db, { units, uid: item.constructor.resolveUid?.(p) ?? null });
    } },

    /**
     * Создать объект в листе: { post|body, time?, unit?, place?, ext_of?, valid_from? }.
     * Подразделение и место — из мест записи пользователя: не указаны — единственные доступные.
     */
    db_create: { level: 'write', fn: method('write', async ({ db, cls, item, p, uid, scope }) => {
        const at = await writePlace(db, cls, p, scope);
        const obj = createObject(db, {
            cid: cls.cid, body: bodyOf(p) ?? {}, time: p.time, unit: at.unit, place: at.place,
            ext_of: p.ext_of, valid_from: p.valid_from, author: uid,
        });
        if (obj)
            await logOperationFact(db, item, obj, obj.status === 'registered' ? 'Проведено' : 'Создано', uid, p);
        return obj;
    }) },

    /**
     * Объект: { id, at? } — состояние на момент. На виртуальном справочнике — объект его реестра.
     * `names` — названия объектов по его ссылкам (форма показывает ссылки без запроса на каждую).
     */
    db_read: { level: 'read', fn: method('read', async ({ db, cls, p, vis }) => {
        const obj = readObject(db, await visibleObject(db, cls, p.id, vis, p), { at: p.at });
        return obj && { ...obj, names: linkNames(db, [obj.id]) };
    }) },

    /** Версии объекта: { id }. */
    db_versions: { level: 'read', fn: method('read', async ({ db, cls, p, vis }) => objectVersions(db, await visibleObject(db, cls, p.id, vis, p))) },

    /** Изменить объект: { id, post|body, replace?, time?, valid_from?, version? }. */
    db_update: { level: 'write', fn: method('write', ({ db, cls, p, uid, vis }) => updateObject(db, {
        id: ownObject(db, cls, p.id, vis), body: bodyOf(p), replace: flag(p.replace), time: p.time,
        valid_from: p.valid_from, version: p.version, author: uid,
    })) },

    /** Удалить объект (отметка): { id, version? }. */
    db_delete: { level: 'write', fn: method('write', ({ db, cls, p, uid, vis }) => deleteObject(db, { id: ownObject(db, cls, p.id, vis), version: p.version, author: uid })) },

    /** Восстановить удалённый: { id }. */
    db_restore: { level: 'write', fn: method('write', ({ db, cls, p, uid, vis }) => restoreObject(db, { id: ownObject(db, cls, p.id, vis), author: uid })) },

    /** Выборка объектов класса (с потомками): параметры queryObjects; `names` — названия объектов по ссылкам. */
    db_query: { level: 'read', fn: method('read', ({ db, cls, p, vis }) => {
        const res = queryObjects(db, {
            cid: cls.cid, deep: optFlag(p.deep), status: list(p.status, 'status'), where: json(p.where, 'where'),
            search: p.search, from: p.from, to: p.to, units: list(p.units, 'units'), unit: p.unit, author: p.author,
            ext_of: p.ext_of, order: p.order, limit: p.limit, offset: p.offset, visible: vis,
        });
        return { ...res, names: linkNames(db, res.items.map(o => o.id)) };
    }) },

    /** Кандидаты для ссылки на этот справочник: { at?, search?, all?, limit? }. */
    db_choices: { level: 'read', fn: method('read', async ({ db, cls, p, vis }) => linkChoices(db, {
        target: cls.cid, at: p.at, search: p.search, all: flag(p.all), limit: p.limit,
        units: list(p.units, 'units'), unit: p.unit, visible: vis,
        registryVisible: cls.type === '$virtual' ? await registryGrants(db, cls, vis, p) : undefined,
    })) },

    /** Состав виртуального справочника на момент: { at?, mode? }. */
    db_members: { level: 'read', fn: method('read', ({ db, cls, p, vis }) => virtualMembers(db, {
        cid: cls.cid, at: p.at, mode: p.mode, units: list(p.units, 'units'), unit: p.unit, visible: entryGrants(withoutBranches(vis), 'catalog'),
    })) },

    /** Зарегистрировать черновик: { id, version? }. */
    db_register: { level: 'write', fn: method('write', async ({ db, cls, item, p, uid, vis }) => {
        const op = registerOperation(db, { id: ownObject(db, cls, p.id, vis), version: p.version, author: uid });
        await logOperationFact(db, item, op, 'Проведено', uid, p);
        return op;
    }) },

    /** Исправить зарегистрированную: { id, post|body, replace?, time?, version? }. */
    db_correct: { level: 'write', fn: method('write', async ({ db, cls, item, p, uid, vis }) => {
        const op = correctOperation(db, {
            id: ownObject(db, cls, p.id, vis), body: bodyOf(p), replace: flag(p.replace), time: p.time, version: p.version, author: uid,
        });
        await logOperationFact(db, item, op, 'Исправлено', uid, p);
        return op;
    }) },

    /** Отменить зарегистрированную: { id, version? }. */
    db_cancel: { level: 'write', fn: method('write', async ({ db, cls, item, p, uid, vis }) => {
        const op = cancelOperation(db, { id: ownObject(db, cls, p.id, vis), version: p.version, author: uid });
        await logOperationFact(db, item, op, 'Отменено', uid, p);
        return op;
    }) },

    /**
     * Проводки без записи: { id } или { post|body, time? } для листа операции.
     * `names` — названия счетов (cid) и объектов аналитик для показа.
     */
    db_preview: { level: 'read', fn: method('read', ({ db, cls, p, vis }) => {
        const res = isEmpty(p.id)
            ? previewEntries(db, { cid: cls.cid, body: bodyOf(p) ?? {}, time: p.time })
            : previewEntries(db, { id: ownObject(db, cls, p.id, vis) });
        return {
            ...res,
            names: namesOf(db,
                res.entries.flatMap(e => [...Object.values(e.debit_analytics), ...Object.values(e.credit_analytics)]),
                res.entries.flatMap(e => [e.debit, e.credit])),
        };
    }) },

    /** Проводки операции: { id, history? }. */
    db_entries: { level: 'read', fn: method('read', ({ db, cls, p, vis }) => operationEntries(db, ownObject(db, cls, p.id, vis), { history: flag(p.history) })) },

    /**
     * Печатные формы операции: { id? } — формы класса объекта (с унаследованными), без id — класса вызова.
     * Не операция — пустой список. Ответ: [{ name, label, source }].
     */
    db_print_list: { level: 'read', fn: method('read', async ({ db, cls, p, vis }) => {
        const cid = isEmpty(p.id) ? cls.cid : readObject(db, ownObject(db, cls, p.id, vis))?.cid;
        if (!cid || familyOf(getClass(db, cid)) !== 'operation')
            return [];
        return (await printTemplates(db, process.cwd(), cid)).map(({ name, label, source }) => ({ name, label, source }));
    }) },

    /** Печатная форма объекта: { id, name? } → { name, label, source, html } (name не нужен, если форма одна). */
    db_print: { level: 'read', fn: method('read', async ({ db, cls, p, vis }) => renderPrint(db, {
        id: ownObject(db, cls, p.id, vis), name: p.name, root: process.cwd(),
    })) },

    /**
     * Журнал проводок. На счёте (журнале) — проводки его счетов, на классе операций —
     * проводки его операций. { from?, to?, account?, debit?, credit?, object?, effective?, desc?, limit?, offset? }
     * Видимость ветки-счёта — по любой стороне проводки, ветки операций — по классу операции.
     */
    db_journal: { level: 'read', fn: method('read', ({ db, cls, p, vis }) => {
        const q = {
            ...entryFilters(p), from: p.from, to: p.to, object: p.object,
            effective: flag(p.effective), desc: flag(p.desc), limit: p.limit, offset: p.offset,
            visible: entryGrants(vis, familyOf(cls)),
        };
        if (familyOf(cls) === 'operation') {
            q.op_cid = isEmpty(p.op_cid) ? cls.cid : inside(db, cls, p.op_cid, 'класс операций');
            for (const k of ['account', 'debit', 'credit'])
                q[k] = p[k];
        }
        else {
            q.account = reportAccount(db, cls, p.account);
            if (!isEmpty(p.debit))
                q.debit = inside(db, cls, p.debit, 'счёт');
            if (!isEmpty(p.credit))
                q.credit = inside(db, cls, p.credit, 'счёт');
        }
        return journal(db, q);
    }) },

    /** ОСВ по счёту (журналу) вызова: { from?, to?, account?, by?, analytics?, subanalytics? }. */
    db_sheet: { level: 'read', fn: method('read', ({ db, cls, p, vis }) => trialBalance(db, {
        ...entryFilters(p), from: p.from, to: p.to, account: reportAccount(db, cls, p.account), by: list(p.by, 'by'),
        analytics: json(p.analytics, 'analytics'), subanalytics: json(p.subanalytics, 'subanalytics'),
        visible: entryGrants(vis, 'account'),
    })) },

    /** Карточка счёта: { from?, to?, account?, analytics?, subanalytics?, limit?, offset? }. */
    db_card: { level: 'read', fn: method('read', ({ db, cls, p, vis }) => accountCard(db, {
        ...entryFilters(p), from: p.from, to: p.to, account: reportAccount(db, cls, p.account),
        analytics: json(p.analytics, 'analytics'), subanalytics: json(p.subanalytics, 'subanalytics'),
        limit: p.limit, offset: p.offset, visible: entryGrants(vis, 'account'),
    })) },

    /** Двухпанельные Обороты счёта (Экран 3 ODANT): { from?, to?, account?, groupBy?, group?, analytics?, subanalytics?, limit? }. */
    db_turnovers: { level: 'read', fn: method('read', ({ db, cls, p, vis }) => accountTurnovers(db, {
        ...entryFilters(p), from: p.from, to: p.to, account: reportAccount(db, cls, p.account),
        groupBy: p.groupBy, group: p.group,
        analytics: json(p.analytics, 'analytics'), subanalytics: json(p.subanalytics, 'subanalytics'),
        limit: p.limit, visible: entryGrants(vis, 'account'),
    })) },

    /** Сборная карточка проводки (Экран 4 ODANT) из записей счетов Дт и Кт: { entry|id }. */
    db_entry: { level: 'read', fn: method('read', ({ db, p }) => readEntry(db, p.entry ?? p.id)) },

    /** Состояние объекта класса на момент: { id, at?, account? }. */
    db_state: { level: 'read', fn: method('read', async ({ db, cls, p, vis }) => {
        const id = await visibleObject(db, cls, p.id, vis, p);
        return objectState(db, { ...entryFilters(p), id, at: p.at, account: p.account, visible: objectEntryGrants(db, cls, id, vis) });
    }) },

    /** Траектория объекта класса: { id, from?, to?, account?, limit?, offset? }. */
    db_trajectory: { level: 'read', fn: method('read', async ({ db, cls, p, vis }) => {
        const id = await visibleObject(db, cls, p.id, vis, p);
        return objectTrajectory(db, {
            ...entryFilters(p), id, from: p.from, to: p.to, account: p.account,
            limit: p.limit, offset: p.offset, visible: objectEntryGrants(db, cls, id, vis),
        });
    }) },

    /** Закрыть период по день включительно ({ day }; пусто — открыть) или узнать дату закрытия ({}). */
    db_close_period: { level: 'admin', fn: method('admin', ({ db, p }) => ({
        closed_until: 'day' in p ? closePeriod(db, p.day) : closedUntil(db),
    })) },
});
