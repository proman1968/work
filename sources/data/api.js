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
import { DEV_MODE } from '../host/config.js';
import { dataDb } from './db.js';
import { refreshClasses, getClass, descendants, classesOfType, DEFAULT_ROOTS, STRUCTURE_TYPES } from './classes.js';
import { classSchema, checkSchema, FAMILY } from './schema.js';
import {
    createObject, readObject, objectVersions, updateObject, deleteObject, restoreObject, queryObjects, linkCids,
} from './objects.js';
import {
    registerOperation, correctOperation, cancelOperation, previewEntries, operationEntries, closePeriod, closedUntil,
} from './posting.js';
import {
    journal, trialBalance, accountCard, objectState, objectTrajectory, virtualMembers, isVirtualMember, namesOf,
} from './reports.js';
import { linkChoices } from './choices.js';
import {
    scopeGrants, entryGrants, withoutBranches, objectCond, visibleUnits, writeContexts, resolvePlace,
} from './scope.js';
import { DataError } from './errors.js';
import { normalizeSecurity, walkPlaces, trailKey } from '../server/access/workplaces.js';

/** Ссылки рабочих мест — модулем по требованию: links.js тянет сервер, который сам импортирует этот модуль. */
const linksModule = () => import('../server/access/links.js');

let dirty = true;
let refreshing = null;

/** Кэш классов устарел (правка class.js): обновится перед следующим обращением. */
export function markClassesDirty() {
    dirty = true;
}

/** БД данных с актуальным кэшем классов. */
export async function dataStore() {
    const db = await dataDb();
    while (dirty || refreshing) {
        if (!refreshing) {
            dirty = false;
            refreshing = refreshClasses(db, process.cwd())
                .then(r => {
                    if (r.problems.length)
                        console.warn('[data] классы:', r.problems.join('; '));
                })
                .catch(e => {
                    dirty = true;
                    throw e;
                })
                .finally(() => {
                    refreshing = null;
                });
        }
        await refreshing;
    }
    return db;
}

/** Есть ли у класса ядра собственные неудалённые объекты (инвариант листа при создании дочернего класса). */
export async function classHasObjects(ref) {
    const db = await dataStore();
    const cls = getClass(db, String(ref ?? ''));
    return !!cls && !!db.prepare("SELECT 1 FROM objects WHERE cid = ? AND status <> 'deleted' LIMIT 1").get(cls.cid);
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

async function classOf(db, item) {
    const ref = String(item?.path ?? '');
    let cls = getClass(db, ref);
    if (!cls && underData(ref)) {
        markClassesDirty();
        await dataStore();
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
        let uid = null;
        if (level === 'read')
            await item.assertAccess(p, item.constructor.ACCESS_LEVEL.READ);
        else if (level === 'write')
            uid = await item._assertDataWrite(p);
        else
            await admin(item, p);
        const db = await dataStore();
        const cls = await classOf(db, item);
        const scope = level === 'admin'
            ? { full: true, links: [], grants: null }
            : await scopeOf(item, p, db, cls, level === 'write');
        if (scope.grants?.length === 0)
            throw new Error('Доступ запрещён');
        return fn({ db, cls, p, uid, scope, vis: scope.grants });
    };
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

/**
 * Методы ядра: имя → { level — уровень шлюза (access/gateway.js), fn(item, params) }.
 * Устанавливаются в прототип `$class` (sources/server/class.js).
 */
export const DATA_METHODS = Object.freeze({
    /**
     * Схема класса по наследованию и ошибки конфигурации: { schema, errors }.
     * Схема вложена: ответ с `type`/`path` на верхнем уровне клиент (WORK.__bind) превратил бы в элемент дерева.
     */
    db_schema: { level: 'read', fn: method('read', ({ db, cls }) => ({ schema: classSchema(db, cls.cid), errors: checkSchema(db, cls.cid) })) },

    /**
     * Видимость и места записи пользователя в классе: { all, units, contexts }.
     * all — видны все данные; units — подразделения для фильтра отчётов и выборок
     * ({ cid, path, label }; при all — все подразделения); contexts — подразделения и места,
     * от которых можно создать объект ({ unit, unit_label, place, place_label, any? }).
     */
    db_scope: { level: 'read', fn: method('read', ({ db, cls, scope }) => ({
        all: scope.grants === null,
        units: (visibleUnits(scope.grants) ?? classesOfType(db, STRUCTURE_TYPES).map(c => c.cid)).map(cid => {
            const c = getClass(db, cid);
            return { cid, path: c?.path ?? cid, label: c?.label ?? cid };
        }),
        contexts: writeContexts(db, cls, scope.links),
    })) },

    /**
     * Создать объект в листе: { post|body, time?, unit?, place?, ext_of?, valid_from? }.
     * Подразделение и место — из мест записи пользователя: не указаны — единственные доступные.
     */
    db_create: { level: 'write', fn: method('write', async ({ db, cls, p, uid, scope }) => {
        const at = await writePlace(db, cls, p, scope);
        return createObject(db, {
            cid: cls.cid, body: bodyOf(p) ?? {}, time: p.time, unit: at.unit, place: at.place,
            ext_of: p.ext_of, valid_from: p.valid_from, author: uid,
        });
    }) },

    /** Объект: { id, at? } — состояние на момент. На виртуальном справочнике — объект его реестра. */
    db_read: { level: 'read', fn: method('read', async ({ db, cls, p, vis }) => readObject(db, await visibleObject(db, cls, p.id, vis, p), { at: p.at })) },

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
            search: p.search, from: p.from, to: p.to, units: list(p.units, 'units'), author: p.author,
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

    /** Состав виртуального справочника на момент: { at? }. */
    db_members: { level: 'read', fn: method('read', ({ db, cls, p, vis }) => virtualMembers(db, {
        cid: cls.cid, at: p.at, units: list(p.units, 'units'), unit: p.unit, visible: entryGrants(withoutBranches(vis), 'catalog'),
    })) },

    /** Зарегистрировать черновик: { id, version? }. */
    db_register: { level: 'write', fn: method('write', ({ db, cls, p, uid, vis }) => registerOperation(db, { id: ownObject(db, cls, p.id, vis), version: p.version, author: uid })) },

    /** Исправить зарегистрированную: { id, post|body, replace?, time?, version? }. */
    db_correct: { level: 'write', fn: method('write', ({ db, cls, p, uid, vis }) => correctOperation(db, {
        id: ownObject(db, cls, p.id, vis), body: bodyOf(p), replace: flag(p.replace), time: p.time, version: p.version, author: uid,
    })) },

    /** Отменить зарегистрированную: { id, version? }. */
    db_cancel: { level: 'write', fn: method('write', ({ db, cls, p, uid, vis }) => cancelOperation(db, { id: ownObject(db, cls, p.id, vis), version: p.version, author: uid })) },

    /** Проводки без записи: { id } или { post|body, time? } для листа операции. */
    db_preview: { level: 'read', fn: method('read', ({ db, cls, p, vis }) => (isEmpty(p.id)
        ? previewEntries(db, { cid: cls.cid, body: bodyOf(p) ?? {}, time: p.time })
        : previewEntries(db, { id: ownObject(db, cls, p.id, vis) }))) },

    /** Проводки операции: { id, history? }. */
    db_entries: { level: 'read', fn: method('read', ({ db, cls, p, vis }) => operationEntries(db, ownObject(db, cls, p.id, vis), { history: flag(p.history) })) },

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

    /** ОСВ по счёту (журналу) вызова: { from?, to?, account?, by? }. */
    db_sheet: { level: 'read', fn: method('read', ({ db, cls, p, vis }) => trialBalance(db, {
        ...entryFilters(p), from: p.from, to: p.to, account: reportAccount(db, cls, p.account), by: list(p.by, 'by'),
        visible: entryGrants(vis, 'account'),
    })) },

    /** Карточка счёта: { from?, to?, account?, analytics?, limit?, offset? }. */
    db_card: { level: 'read', fn: method('read', ({ db, cls, p, vis }) => accountCard(db, {
        ...entryFilters(p), from: p.from, to: p.to, account: reportAccount(db, cls, p.account),
        analytics: json(p.analytics, 'analytics'), limit: p.limit, offset: p.offset, visible: entryGrants(vis, 'account'),
    })) },

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
