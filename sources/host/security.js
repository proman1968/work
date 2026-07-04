import { FS } from '../server/index.js';
import { parseDevMode } from './config.js';

export const ACCESS_DENIED = 'Доступ запрещён';

/** В dev (`WORK_DEV`) enforcement отключён — prod/start без флага. */
export function isSecurityEnabled(env = process.env) {
    return !parseDevMode(env);
}

export const DESTRUCTIVE_METHODS = new Set(['delete', 'remove']);

export const WRITE_METHODS = new Set(['save', 'save_file', 'save_files', 'create']);

export const ADMIN_ONLY_METHODS = new Set(['read_secret', 'save_secret']);

/** Уровни доступа к методам item. */
export const ACCESS_LEVEL = {
    READ: 'read',
    WRITE: 'write',
    ADMIN: 'admin',
};

/** Явная политика по имени метода; остальное — resolveMethodAccessLevel. */
export const METHOD_ACCESS = {
    info: ACCESS_LEVEL.READ,
    load: ACCESS_LEVEL.READ,
    script: ACCESS_LEVEL.READ,
    import: ACCESS_LEVEL.READ,
    download: ACCESS_LEVEL.READ,
    size: ACCESS_LEVEL.READ,
    inherit: ACCESS_LEVEL.READ,
    handlers: ACCESS_LEVEL.READ,
    search: ACCESS_LEVEL.READ,
    manifest: ACCESS_LEVEL.READ,
    logs: ACCESS_LEVEL.READ,
    log_index: ACCESS_LEVEL.READ,
    read_log_bodies: ACCESS_LEVEL.READ,
    read_log_entry: ACCESS_LEVEL.READ,
    task_reply: ACCESS_LEVEL.WRITE,
    isAdmin: ACCESS_LEVEL.READ,
    isAssignedUser: ACCESS_LEVEL.READ,
    execute: ACCESS_LEVEL.READ,

    save: ACCESS_LEVEL.WRITE,
    save_file: ACCESS_LEVEL.WRITE,
    save_files: ACCESS_LEVEL.WRITE,
    create: ACCESS_LEVEL.WRITE,
    write_to_stream: ACCESS_LEVEL.WRITE,
    close_write_stream: ACCESS_LEVEL.WRITE,
    get_write_stream: ACCESS_LEVEL.WRITE,
    save_includes: ACCESS_LEVEL.WRITE,
    restore_from_history: ACCESS_LEVEL.WRITE,
    reset: ACCESS_LEVEL.WRITE,

    delete: ACCESS_LEVEL.ADMIN,
    remove: ACCESS_LEVEL.ADMIN,
    clear_rag: ACCESS_LEVEL.ADMIN,
    read_secret: ACCESS_LEVEL.ADMIN,
    save_secret: ACCESS_LEVEL.ADMIN,
};

/** uid из params.user (сессия host). Только при явном user.uid после входа. */
export function resolveUid(params = {}) {
    const user = params.user;
    if (!user?.uid)
        return null;
    return user.$user?.id ?? user.uid;
}

/** На storage явно назначены users — граница подразделения. */
export function hasAssignedUsers(security) {
    return Array.isArray(security?.users) && security.users.length > 0;
}

export function hasUserBoundary(storage) {
    return hasAssignedUsers(storage?.DATA?.['#security']);
}

export function isDestructiveMethod(method) {
    return DESTRUCTIVE_METHODS.has(method);
}

export function isWriteMethod(method) {
    return WRITE_METHODS.has(method);
}

export function isAdminOnlyMethod(method) {
    return ADMIN_ONLY_METHODS.has(method);
}

/** Личный кабинет: /users//{uid}/$user/… */
export function parseUserCabinetUid(path = '') {
    const m = path.match(/^\/users\/+(?:\/([^/]+)|([^/]+))\/\$user(?:\/|$)/);
    return m?.[1] || m?.[2] || null;
}

export function isUserCabinetPath(path = '') {
    return parseUserCabinetUid(path) != null;
}

export function isOwnUserCabinetPath(path = '', uid) {
    if (!uid || !path)
        return false;
    return parseUserCabinetUid(path) === uid;
}

export async function isStorageAdmin(storage, params = {}) {
    const uid = resolveUid(params);
    if (!uid || !storage?.admins)
        return false;
    const admins = await storage.admins;
    return admins?.some(a => a?.id === uid) ?? false;
}

export async function isAssignedOnStorage(storage, params = {}) {
    if (!storage || !hasUserBoundary(storage))
        return false;
    const uid = resolveUid(params);
    if (!uid || !storage.users)
        return false;
    const users = await storage.users;
    return users?.some(u => u?.id === uid) ?? false;
}

/** Корень WORK (path у $server — ''). */
export function isWorkRoot(item) {
    return item === globalThis.WORK || item?.id === 'WORK';
}

/** Путь под $server (система платформы). */
export function is$serverPath(path = '') {
    return path === '/$server' || path.startsWith('/$server/');
}

/** Системные папки в корне проекта (без метапапки): sources, oda, root как контейнер, … */
const SYSTEM_ROOT_NAMES = new Set([
    'sources', 'oda', 'docs', 'scripts', 'register', 'support', 'paas', 'torus',
    'root', 'nodes', 'services', 'skills',
]);

/** Файл или папка непосредственно в корне WORK (кроме users). */
export function isWorkRootChildPath(path = '') {
    const parts = path.split('/').filter(Boolean);
    return parts.length === 1 && parts[0] !== 'users';
}

/** Любое хранилище $storage (в т.ч. $base, $node, $group …), не $file/$folder. */
export function isStorageItem(item) {
    if (!item || typeof item !== 'object')
        return false;
    if (item instanceof FS.$storage)
        return true;
    const type = item.type ?? '';
    if (!type || type === '$file' || type === '$folder' || type === '$handler')
        return false;
    return type[0] === '$';
}

/** Системный элемент в корне WORK: файлы и обычные папки, не $storage. */
export function isWorkRootSystemChild(item) {
    const path = item?.path ?? '';
    if (!isWorkRootChildPath(path))
        return false;
    return !isStorageItem(item);
}

/** Элемент в метапапке хранилища (контент). */
export function isInsideMetaFolder(item) {
    let p = item;
    while (p) {
        if (p.isMetaFolder)
            return true;
        p = p.parent;
    }
    const path = item?.path ?? '';
    if (isPathInsideUserCabinetMeta(path))
        return true;
    return isPathInsideWorkStorageMeta(path);
}

function isPathInsideUserCabinetMeta(path) {
    return /^\/users\/+(?:\/[^/]+|[^/]+)\/\$user\/.+/.test(path);
}

function isPathInsideWorkStorageMeta(path) {
    if (is$serverPath(path) || path.startsWith('/users'))
        return false;
    return /\/\$structure\/.+/.test(path);
}

/** Путь зашёл в рабочее хранилище: /root/…/$group, не просто контейнер /root. */
export function pathEntersDataStorage(path = '') {
    if (is$serverPath(path) || path.startsWith('/users'))
        return false;
    const parts = path.split('/').filter(Boolean);
    if (!parts.length || !SYSTEM_ROOT_NAMES.has(parts[0]))
        return false;
    const dollarIdx = parts.findIndex(p => p[0] === '$');
    return dollarIdx >= 2;
}

/** Рабочее хранилище (не $server). */
export function isDataStorage(storage) {
    return resolveDataStorageRef(storage) != null;
}

function resolveDataStorageRef(ref) {
    if (!ref)
        return null;
    const path = ref.path ?? '';
    if (is$serverPath(path) || ref.id === '$server')
        return null;
    if (ref instanceof FS.$storage)
        return ref;
    if (!pathEntersDataStorage(path))
        return null;
    const last = path.split('/').filter(Boolean).pop();
    if (last?.[0] === '$')
        return ref;
    return null;
}

/** Ближайший $storage вверх по дереву. */
export function nearestStorage(item) {
    if (item?.$storage) {
        const s = resolveDataStorageRef(item.$storage);
        if (s)
            return s;
    }
    let p = item;
    while (p) {
        const s = resolveDataStorageRef(p);
        if (s)
            return s;
        p = p.parent;
    }
    return null;
}

/** Хранилище, чья метапапка содержит item. */
export function contentStorage(item) {
    let p = item;
    while (p) {
        if (p.isMetaFolder && p.parent instanceof FS.$storage)
            return p.parent;
        p = p.parent;
    }
    if (isPathInsideUserCabinetMeta(item?.path ?? ''))
        return nearestStorage(item);
    return null;
}

/**
 * Система: $server, файлы/папки корня без users, пути внутри системных
 * корневых контейнеров до входа в рабочее хранилище.
 */
export function isSystemItem(item) {
    if (!item)
        return false;
    if (isWorkRoot(item))
        return true;

    const path = item.path ?? '';
    if (!path)
        return true;

    if (is$serverPath(path))
        return true;
    if (path.startsWith('/sources') || path.startsWith('/oda'))
        return true;
    if (isWorkRootSystemChild(item))
        return true;

    if (pathEntersDataStorage(path))
        return false;

    if (isWorkRootChildPath(path) && isStorageItem(item))
        return false;

    const parts = path.split('/').filter(Boolean);
    if (!parts.length || !SYSTEM_ROOT_NAMES.has(parts[0]))
        return false;

    const storage = nearestStorage(item);
    if (!storage || !isDataStorage(storage))
        return true;

    return false;
}

function accessCache(params) {
    return params._storageAccess ??= new Map();
}

/** Доступ к $storage: назначение, pass-through или admin. */
export async function hasStorageAccess(storage, params = {}) {
    if (!storage)
        return false;
    const cache = accessCache(params);
    const key = storage.path || storage.id;
    if (cache.has(key))
        return cache.get(key);

    let allowed = false;
    if (await isStorageAdmin(storage, params))
        allowed = true;
    else if (await isAssignedOnStorage(storage, params))
        allowed = true;
    else if (!hasUserBoundary(storage)) {
        let p = storage.parent;
        while (p) {
            if (p instanceof FS.$storage && p !== storage) {
                allowed = await hasStorageAccess(p, params);
                break;
            }
            p = p.parent;
        }
    }
    cache.set(key, allowed);
    return allowed;
}

async function canSeeUsersBranch(item, params) {
    const uid = resolveUid(params);
    if (!uid)
        return false;

    const path = item.path ?? '';
    const cabinetUid = parseUserCabinetUid(path);
    if (!cabinetUid)
        return true;

    if (cabinetUid === uid)
        return true;

    if (isInsideMetaFolder(item))
        return false;

    return true;
}

async function canSeeDataStorageItem(item, params) {
    const storage = contentStorage(item) || nearestStorage(item);
    if (!storage)
        return false;

    const access = await hasStorageAccess(storage, params);
    if (access)
        return true;

    if (isInsideMetaFolder(item))
        return false;

    if (!hasUserBoundary(storage))
        return false;

    let p = storage.parent;
    while (p) {
        if (p instanceof FS.$storage && await hasStorageAccess(p, params))
            return true;
        p = p.parent;
    }
    return false;
}

async function canWriteUsersBranch(item, params) {
    const uid = resolveUid(params);
    if (!uid)
        return false;

    const path = item.path ?? '';
    const cabinetUid = parseUserCabinetUid(path);
    if (!cabinetUid)
        return false;

    if (cabinetUid === uid)
        return true;

    return false;
}

async function canWriteDataStorageItem(item, params) {
    const storage = contentStorage(item) || nearestStorage(item);
    if (!storage)
        return false;

    if (await isStorageAdmin(storage, params))
        return true;

    if (isInsideMetaFolder(item))
        return hasStorageAccess(storage, params);

    return false;
}

/**
 * Видимость item в HTTP-дереве (get_item).
 */
export async function canSee(item, params = {}) {
    if (!isSecurityEnabled())
        return true;
    if (!item || typeof item !== 'object')
        return true;

    const path = item.path ?? '';

    if (globalThis.WORK && await isStorageAdmin(globalThis.WORK, params))
        return true;

    if (isSystemItem(item))
        return true;

    const uid = resolveUid(params);
    if (!uid)
        return false;

    if (path === '/users' || path.startsWith('/users/'))
        return canSeeUsersBranch(item, params);

    if (pathEntersDataStorage(path) || (item instanceof FS.$storage && isDataStorage(item)))
        return canSeeDataStorageItem(item, params);

    const storage = nearestStorage(item);
    if (storage && isDataStorage(storage))
        return canSeeDataStorageItem(item, params);

    return false;
}

/**
 * Право записи: системные зоны — только WORK admin; метапапка $storage — hasStorageAccess;
 * системная зона $storage — admin точки; свой users//uid/$user — владелец.
 */
export async function canWrite(item, params = {}) {
    if (!isSecurityEnabled())
        return true;
    if (!item || typeof item !== 'object')
        return false;

    const uid = resolveUid(params);
    if (!uid)
        return false;

    if (globalThis.WORK && await isStorageAdmin(globalThis.WORK, params))
        return true;

    const path = item.path ?? '';

    if (isSystemItem(item))
        return false;

    if (path === '/users' || path.startsWith('/users/'))
        return canWriteUsersBranch(item, params);

    if (pathEntersDataStorage(path) || (item instanceof FS.$storage && isDataStorage(item)))
        return canWriteDataStorageItem(item, params);

    const storage = nearestStorage(item);
    if (storage && isDataStorage(storage))
        return canWriteDataStorageItem(item, params);

    return false;
}

export async function filterGetItemResult(result, params) {
    if (!isSecurityEnabled() || !params?.user)
        return result;
    if (result == null || typeof result === 'string')
        return result;

    if (Array.isArray(result)) {
        const flags = await Promise.all(result.map(i => canSee(i, params)));
        return result.filter((_, i) => flags[i]);
    }

    return (await canSee(result, params)) ? result : undefined;
}

const INFO_CHILD_LISTS = ['items', 'files', 'folders', 'children'];

/** Фильтр ответа info(deep): вложенные списки детей. */
export async function filterInfoResult(result, params) {
    if (!isSecurityEnabled() || !params?.user)
        return result;
    if (result == null || typeof result !== 'object' || Array.isArray(result))
        return result;

    const out = { ...result };
    for (const key of INFO_CHILD_LISTS) {
        if (!Array.isArray(out[key]))
            continue;
        const flags = await Promise.all(out[key].map(i => canSee(i, params)));
        out[key] = await Promise.all(
            out[key]
                .filter((_, i) => flags[i])
                .map(i => filterInfoResult(i, params))
        );
    }
    return out;
}

/** Единая точка фильтрации HTTP-ответа с FS-деревом. */
export async function filterHttpTreeResult(result, params, { method = '' } = {}) {
    if (!isSecurityEnabled() || !params?.user)
        return result;
    if (method === 'task_reply' || method === 'read_log_entry' || method === 'read_log_bodies' || method === 'log_index')
        return result;
    if (method === 'info' && result && typeof result === 'object' && !Array.isArray(result))
        return filterInfoResult(result, params);
    return filterGetItemResult(result, params);
}

/** Уровень доступа для метода (таблица + HTTP-глаголы класса + эвристики). */
export function resolveMethodAccessLevel(method, item) {
    if (METHOD_ACCESS[method])
        return METHOD_ACCESS[method];
    if (isDestructiveMethod(method) || isAdminOnlyMethod(method))
        return ACCESS_LEVEL.ADMIN;
    if (isWriteMethod(method))
        return ACCESS_LEVEL.WRITE;
    if (item) {
        if (method === item.constructor?.DELETE)
            return ACCESS_LEVEL.ADMIN;
        if (method === item.constructor?.POST)
            return ACCESS_LEVEL.WRITE;
        if (method === item.constructor?.GET)
            return ACCESS_LEVEL.READ;
    }
    return ACCESS_LEVEL.READ;
}

/**
 * Проверка доступа по уровню: read → canSee, write → canWrite, admin → admin точки.
 * WORK admin проходит любой уровень.
 */
export async function allowAccess(item, params = {}, level = ACCESS_LEVEL.READ) {
    if (!isSecurityEnabled())
        return;
    if (!params?.user)
        return;
    if (params.user === globalThis.WORK)
        return;
    if (!item)
        throw new Error(ACCESS_DENIED);

    const uid = resolveUid(params);
    if (!uid && level !== ACCESS_LEVEL.READ)
        throw new Error(ACCESS_DENIED);

    if (globalThis.WORK && await isStorageAdmin(globalThis.WORK, params))
        return;

    switch (level) {
        case ACCESS_LEVEL.READ:
            if (!(await canSee(item, params)))
                throw new Error(ACCESS_DENIED);
            break;
        case ACCESS_LEVEL.WRITE:
            if (!(await canWrite(item, params)))
                throw new Error(ACCESS_DENIED);
            break;
        case ACCESS_LEVEL.ADMIN: {
            const storage = item.$storage ?? (item instanceof FS.$storage ? item : null);
            if (storage && await isStorageAdmin(storage, params))
                return;
            throw new Error(ACCESS_DENIED);
        }
        default:
            throw new Error(ACCESS_DENIED);
    }
}

/**
 * @deprecated Проверки доступа — в телах контекстных методов через allowAccess.
 * Оставлен для assertCanExecuteMethod и unit-тестов политики METHOD_ACCESS.
 */
export async function assertMethodAccess(item, method, params = {}) {
    if (!isSecurityEnabled())
        return;
    if (!method || !item)
        return;

    if (!params.user)
        return;

    const level = resolveMethodAccessLevel(method, item);
    const uid = resolveUid(params);

    if (!uid && level !== ACCESS_LEVEL.READ)
        throw new Error(ACCESS_DENIED);

    await allowAccess(item, params, level);
}

/**
 * @deprecated Используйте assertMethodAccess; оставлен для совместимости.
 */
export async function assertCanExecuteMethod(item, method, params = {}) {
    return assertMethodAccess(item, method, params);
}

/**
 * Первый зарегистрированный пользователь → #security.admin на WORK.
 * Не перезаписывает уже заданного admin.
 */
export async function ensureBootstrapAdmin(server, uid, params = {}) {
    if (!server || !uid)
        return false;
    await server.info({ reset: true });
    if (server.DATA?.['#security']?.admin)
        return false;
    const security = Object.assign({}, server.DATA?.['#security'], { admin: uid });
    const post = server.constructor.toScript({ '#security': security });
    await server.save({ post, user: WORK });
    server.reset?.();
    return true;
}
