/**
 * Методы учётного ядра у классов дерева (`$class`): объекты, проведение, отчёты, выбор ссылки.
 *
 * Метод вызывается на классе, к которому относится запрос: создание — на листе
 * справочника или операции, выборка — на классе с потомками, отчёты — на счёте
 * (или журнале), состав — на виртуальном справочнике. Права — правила этого класса:
 * чтение — `assertAccess(read)` и доступ к данным (`data_access`: предок ссылки рабочего
 * места виден как страница, но не его поддерево), запись — `_assertDataWrite` (автор — субъект сессии),
 * закрытие периода — ADMIN. Объект по `id` доступен только в поддереве класса вызова;
 * чтение через виртуальный справочник видит объекты его реестра (на них ссылаются его поля).
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
import { refreshClasses, getClass, descendants, DEFAULT_ROOTS } from './classes.js';
import { classSchema, checkSchema, FAMILY } from './schema.js';
import {
    createObject, readObject, objectVersions, updateObject, deleteObject, restoreObject, queryObjects, linkCids,
} from './objects.js';
import {
    registerOperation, correctOperation, cancelOperation, previewEntries, operationEntries, closePeriod, closedUntil,
} from './posting.js';
import { journal, trialBalance, accountCard, objectState, objectTrajectory, virtualMembers, namesOf } from './reports.js';
import { linkChoices } from './choices.js';
import { DataError } from './errors.js';

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

/** Объект поддерева класса вызова (для записи и проведения). */
function ownObject(db, cls, id) {
    return objectIn(db, cls, id, descendants(db, cls.cid));
}

/** Объект, видимый через класс: поддерево, у виртуального справочника — его реестр (ссылки на него). */
function visibleObject(db, cls, id) {
    return objectIn(db, cls, id, linkCids(db, cls.cid) ?? descendants(db, cls.cid));
}

function objectIn(db, cls, id, cids) {
    const row = isEmpty(id) ? null : db.prepare('SELECT cid FROM objects WHERE id = ?').get(String(id));
    if (!row || !cids.includes(row.cid))
        throw new DataError(`объект ${id ?? ''} не найден в «${cls.label}»`);
    return String(id);
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
 * Чтение данных: видимость класса и доступ к его данным. Предок ссылки рабочего места виден
 * как страница (каркас цепочки), но его поддерево — это и чужие ветки: данные — только при
 * data_access (назначения или ссылки). Системная сессия, вызов без сессии, DEV, админ WORK
 * и класс, открытый гостям, — без второй проверки.
 */
async function read(item, p) {
    await item.assertAccess(p, item.constructor.ACCESS_LEVEL.READ);
    if (!p?.session || DEV_MODE || p.session.$user === globalThis.WORK || item.DATA?.['#security']?.USER?.includes('GUEST'))
        return;
    if (await item._isWorkAdmin(p).catch(() => false))
        return;
    if ((await item.data_access(p).catch(() => null)) == null)
        throw new Error('Доступ запрещён');
}
const admin = async (item, p) => item.assertAccess(p, item.constructor.ACCESS_LEVEL.ADMIN);

/** Обёртка метода: права, БД, класс вызова. */
function method(level, fn) {
    return async (item, p = {}) => {
        let uid = null;
        if (level === 'read')
            await read(item, p);
        else if (level === 'write')
            uid = await item._assertDataWrite(p);
        else
            await admin(item, p);
        const db = await dataStore();
        const cls = await classOf(db, item);
        return fn({ db, cls, p, uid });
    };
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

    /** Создать объект в листе: { post|body, time?, unit?, place?, ext_of?, valid_from? }. */
    db_create: { level: 'write', fn: method('write', ({ db, cls, p, uid }) => createObject(db, {
        cid: cls.cid, body: bodyOf(p) ?? {}, time: p.time, unit: p.unit, place: p.place,
        ext_of: p.ext_of, valid_from: p.valid_from, author: uid,
    })) },

    /** Объект: { id, at? } — состояние на момент. На виртуальном справочнике — объект его реестра. */
    db_read: { level: 'read', fn: method('read', ({ db, cls, p }) => readObject(db, visibleObject(db, cls, p.id), { at: p.at })) },

    /** Версии объекта: { id }. */
    db_versions: { level: 'read', fn: method('read', ({ db, cls, p }) => objectVersions(db, visibleObject(db, cls, p.id))) },

    /** Изменить объект: { id, post|body, replace?, time?, valid_from?, version? }. */
    db_update: { level: 'write', fn: method('write', ({ db, cls, p, uid }) => updateObject(db, {
        id: ownObject(db, cls, p.id), body: bodyOf(p), replace: flag(p.replace), time: p.time,
        valid_from: p.valid_from, version: p.version, author: uid,
    })) },

    /** Удалить объект (отметка): { id, version? }. */
    db_delete: { level: 'write', fn: method('write', ({ db, cls, p, uid }) => deleteObject(db, { id: ownObject(db, cls, p.id), version: p.version, author: uid })) },

    /** Восстановить удалённый: { id }. */
    db_restore: { level: 'write', fn: method('write', ({ db, cls, p, uid }) => restoreObject(db, { id: ownObject(db, cls, p.id), author: uid })) },

    /** Выборка объектов класса (с потомками): параметры queryObjects; `names` — названия объектов по ссылкам. */
    db_query: { level: 'read', fn: method('read', ({ db, cls, p }) => {
        const res = queryObjects(db, {
            cid: cls.cid, deep: optFlag(p.deep), status: list(p.status, 'status'), where: json(p.where, 'where'),
            search: p.search, from: p.from, to: p.to, units: list(p.units, 'units'), author: p.author,
            ext_of: p.ext_of, order: p.order, limit: p.limit, offset: p.offset,
        });
        return { ...res, names: linkNames(db, res.items.map(o => o.id)) };
    }) },

    /** Кандидаты для ссылки на этот справочник: { at?, search?, all?, limit? }. */
    db_choices: { level: 'read', fn: method('read', ({ db, cls, p }) => linkChoices(db, {
        target: cls.cid, at: p.at, search: p.search, all: flag(p.all), limit: p.limit,
        units: list(p.units, 'units'), unit: p.unit,
    })) },

    /** Состав виртуального справочника на момент: { at? }. */
    db_members: { level: 'read', fn: method('read', ({ db, cls, p }) => virtualMembers(db, {
        cid: cls.cid, at: p.at, units: list(p.units, 'units'), unit: p.unit,
    })) },

    /** Зарегистрировать черновик: { id, version? }. */
    db_register: { level: 'write', fn: method('write', ({ db, cls, p, uid }) => registerOperation(db, { id: ownObject(db, cls, p.id), version: p.version, author: uid })) },

    /** Исправить зарегистрированную: { id, post|body, replace?, time?, version? }. */
    db_correct: { level: 'write', fn: method('write', ({ db, cls, p, uid }) => correctOperation(db, {
        id: ownObject(db, cls, p.id), body: bodyOf(p), replace: flag(p.replace), time: p.time, version: p.version, author: uid,
    })) },

    /** Отменить зарегистрированную: { id, version? }. */
    db_cancel: { level: 'write', fn: method('write', ({ db, cls, p, uid }) => cancelOperation(db, { id: ownObject(db, cls, p.id), version: p.version, author: uid })) },

    /** Проводки без записи: { id } или { post|body, time? } для листа операции. */
    db_preview: { level: 'read', fn: method('read', ({ db, cls, p }) => (isEmpty(p.id)
        ? previewEntries(db, { cid: cls.cid, body: bodyOf(p) ?? {}, time: p.time })
        : previewEntries(db, { id: ownObject(db, cls, p.id) }))) },

    /** Проводки операции: { id, history? }. */
    db_entries: { level: 'read', fn: method('read', ({ db, cls, p }) => operationEntries(db, ownObject(db, cls, p.id), { history: flag(p.history) })) },

    /**
     * Журнал проводок. На счёте (журнале) — проводки его счетов, на классе операций —
     * проводки его операций. { from?, to?, account?, debit?, credit?, object?, effective?, desc?, limit?, offset? }
     */
    db_journal: { level: 'read', fn: method('read', ({ db, cls, p }) => {
        const q = {
            ...entryFilters(p), from: p.from, to: p.to, object: p.object,
            effective: flag(p.effective), desc: flag(p.desc), limit: p.limit, offset: p.offset,
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
    db_sheet: { level: 'read', fn: method('read', ({ db, cls, p }) => trialBalance(db, {
        ...entryFilters(p), from: p.from, to: p.to, account: reportAccount(db, cls, p.account), by: list(p.by, 'by'),
    })) },

    /** Карточка счёта: { from?, to?, account?, analytics?, limit?, offset? }. */
    db_card: { level: 'read', fn: method('read', ({ db, cls, p }) => accountCard(db, {
        ...entryFilters(p), from: p.from, to: p.to, account: reportAccount(db, cls, p.account),
        analytics: json(p.analytics, 'analytics'), limit: p.limit, offset: p.offset,
    })) },

    /** Состояние объекта класса на момент: { id, at?, account? }. */
    db_state: { level: 'read', fn: method('read', ({ db, cls, p }) => objectState(db, {
        ...entryFilters(p), id: visibleObject(db, cls, p.id), at: p.at, account: p.account,
    })) },

    /** Траектория объекта класса: { id, from?, to?, account?, limit?, offset? }. */
    db_trajectory: { level: 'read', fn: method('read', ({ db, cls, p }) => objectTrajectory(db, {
        ...entryFilters(p), id: visibleObject(db, cls, p.id), from: p.from, to: p.to, account: p.account,
        limit: p.limit, offset: p.offset,
    })) },

    /** Закрыть период по день включительно ({ day }; пусто — открыть) или узнать дату закрытия ({}). */
    db_close_period: { level: 'admin', fn: method('admin', ({ db, p }) => ({
        closed_until: 'day' in p ? closePeriod(db, p.day) : closedUntil(db),
    })) },
});
