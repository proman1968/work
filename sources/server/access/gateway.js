/**
 * Шлюз вызова методов элементов извне (HTTP, агент, узлы сети).
 * Снаружи доступно только объявленное: метод/геттер ядра из реестра MEMBERS с уровнем доступа,
 * методы из class.js (DATA, `$method`) — уровень из `ACCESS` class.js, по умолчанию `call`.
 * Сеттеры, внутренние (`_…`, `#…`) и служебные члены недоступны никогда.
 *
 * Уровни:
 *  - public — без проверок (вход, регистрация, публичный ключ push);
 *  - user   — только вошедший субъект;
 *  - read   — право чтения элемента (canSee; для класса — allowAccess: он сам или вложенный виден);
 *  - call   — read + защита от CSRF (методы class.js / `$method` проверяют остальное сами);
 *  - write  — вошедший субъект + защита от CSRF; точное право записи проверяет сам метод;
 *  - admin  — защита от CSRF + ADMIN.
 */
import { FS } from '../index.js';
import { audit } from './audit.js';

export const LEVEL = Object.freeze({ PUBLIC: 'public', USER: 'user', READ: 'read', CALL: 'call', WRITE: 'write', ADMIN: 'admin' });

const ACCESS_DENIED = 'Доступ запрещён';

const L = LEVEL;
/** Реестр членов ядра, доступных снаружи. Всё, чего здесь нет, у классов ядра вызвать нельзя. */
export const MEMBERS = Object.freeze({
    // вход и публичное
    user_register_start: L.PUBLIC, user_register_process: L.PUBLIC, user_register_finish: L.PUBLIC,
    user_login_start: L.PUBLIC, user_login_finish: L.PUBLIC, user_exit: L.PUBLIC,
    get_public_vapid: L.PUBLIC,
    // чтение
    info: L.READ, load: L.READ, download: L.READ, read_text: L.READ, get_imports: L.READ,
    get_schema: L.READ, services_schema: L.READ, handlers: L.READ, manifest: L.READ,
    find_text: L.READ, find_item: L.READ, readme_merged: L.READ,
    semantic_search: L.READ, search: L.READ, query_objects: L.READ, rag_status: L.READ,
    logs: L.READ, logs_dates: L.READ, log_files: L.READ, read_log_bodies: L.READ,
    read_log_entry: L.READ, log_index: L.READ, chatSource: L.READ,
    roles: L.READ, members: L.READ, is_data_type: L.READ, reset: L.READ,
    // геттеры (свойства и списки)
    size: L.READ, METADATA: L.READ, type: L.READ, type_chain: L.READ, label: L.READ, icon: L.READ,
    id: L.READ, name: L.READ, path: L.READ, short: L.READ, online: L.READ, lastModified: L.READ,
    isInherit: L.READ, isCustom: L.READ, time: L.READ, history: L.READ, status: L.READ,
    items: L.READ, entries: L.READ, files: L.READ, folders: L.READ, children: L.READ,
    users: L.READ, guests: L.READ, admins: L.READ, bosses: L.READ, allAdmins: L.READ,
    allBosses: L.READ, assignedUsers: L.READ, declared_roles: L.READ, data_types: L.READ,
    inherit_ancestor: L.READ, ancestor: L.READ, tilde: L.READ, contentType: L.READ,
    $parent: L.READ, $owner: L.READ, $class: L.READ, $folder: L.READ, $users: L.READ,
    types: L.READ, system_types: L.READ,
    // вошедший
    proxy: L.USER, node_grants: L.USER,
    // сеть WORK
    network_graph: L.READ, remote: L.WRITE, node_add: L.ADMIN, node_refresh: L.ADMIN,
    // запись (точное право — внутри метода)
    save_file: L.WRITE, save_files: L.WRITE, save_includes: L.WRITE, save_message: L.WRITE,
    append_log_includes: L.WRITE, save: L.WRITE, edit: L.WRITE, edit_file: L.WRITE,
    ensure_folder: L.WRITE, create: L.WRITE, write_to_stream: L.WRITE, close_write_stream: L.WRITE,
    restore_from_history: L.WRITE, store_push_subscription: L.WRITE,
    create_object: L.WRITE, update_object: L.WRITE, delete_object: L.WRITE, split: L.WRITE,
    read_object: L.READ, query: L.READ,
    remove_push_subscription: L.WRITE, send_push_notification: L.WRITE,
    // администрирование
    delete: L.ADMIN, npm: L.ADMIN, devModeToggle: L.ADMIN, read_secret: L.ADMIN,
    save_secret: L.ADMIN, clear_rag: L.ADMIN, security_log: L.ADMIN,
});

/** Никогда не вызываются снаружи, даже если объявлены в class.js. */
const DENY = new Set([
    'constructor', 'prototype', '__proto__', 'then', 'toJSON', 'valueOf', 'toString', 'hasOwnProperty',
    'init', 'inherit', 'importScript', 'execute', 'assertAccess', 'canSee', 'canWrite', 'allowAccess',
    'areaOf', 'resolveZone', 'fire', 'listen', 'unlisten', 'debounce', 'async', 'DATA', 'ACCESS',
    'signIn', 'get_session', 'sessions', 'settings', 'fs', 'fsp', 'https', 'mime',
    'real_dir', 'real_source', 'dir', 'write_streams', 'keys', 'credentials', 'pageHTML', 'testerHTML',
    'principalId', 'isRegistry',
]);

const NAME_RE = /^[A-Za-z$][\w$]*$/;

let coreProtos = null;
function isCoreProto(proto) {
    if (!coreProtos) {
        coreProtos = new Set();
        for (const C of [FS.$folder, FS.$class, FS.$file, FS.$handler, FS.$trigger, FS.$method, FS.$timer, FS.$user, FS.$node, globalThis.$server])
            if (C?.prototype)
                coreProtos.add(C.prototype);
        let p = FS.$folder?.prototype && Object.getPrototypeOf(FS.$folder.prototype);
        while (p && p !== Object.prototype) {
            coreProtos.add(p);
            p = Object.getPrototypeOf(p);
        }
    }
    return coreProtos.has(proto);
}

/**
 * Найти член элемента и его уровень доступа.
 * @returns {{kind: 'method'|'getter'|'value', level: string, call: Function} | null}
 */
export function resolveMember(item, name) {
    if (typeof name !== 'string' || !NAME_RE.test(name) || name[0] === '_' || DENY.has(name))
        return null;
    let owner = item;
    let desc;
    while (owner && !desc) {
        desc = Object.getOwnPropertyDescriptor(owner, name);
        if (!desc)
            owner = Object.getPrototypeOf(owner);
    }
    if (!desc) {
        // члены class.js, отдаваемые через Reactor-прокси (нет дескриптора на цепочке)
        let value;
        try { value = item?.[name]; } catch { value = undefined; }
        if (typeof value !== 'function' || name[0] === '$' || MEMBERS[name])
            return null;
        const declared = item?.DATA?.ACCESS?.[name];
        const level = Object.values(LEVEL).includes(declared) ? declared : L.CALL;
        return { kind: 'method', level, call: (params, post) => value.call(item, params, post) };
    }
    const own = owner === item;
    let level = MEMBERS[name];
    if (!level) {
        if (own || !isCoreProto(owner)) {
            // методы из class.js (DATA / $method) и прикладных подклассов
            if (name[0] === '$')
                return null;
            const declared = item?.DATA?.ACCESS?.[name];
            level = Object.values(LEVEL).includes(declared) ? declared : (desc.get ? L.READ : L.CALL);
        }
        // геттер ядра — чтение (результат снаружи всё равно фильтруется по правам); методы — только из реестра
        else if (desc.get && name[0] !== '$')
            level = L.READ;
        else
            return null;
    }
    if (typeof desc.value === 'function')
        return { kind: 'method', level, call: (params, post) => desc.value.call(item, params, post) };
    if (desc.get)
        return { kind: 'getter', level, call: () => desc.get.call(item) };
    if ('value' in desc && own && MEMBERS[name])
        return { kind: 'value', level, call: () => desc.value };
    return null;
}

/** Запрос пришёл со своей страницы: клиент WORK всегда шлёт X-WORK-WSID; кросс-сайт так не может без CORS. */
export function isSameOriginRequest(request) {
    const h = request?.headers;
    if (!h)
        return true; // не HTTP (внутренний вызов)
    const host = h.host || h[':authority'];
    if (h.origin) {
        try {
            if (new URL(h.origin).host !== host)
                return false;
        }
        catch { return false; }
    }
    const site = h['sec-fetch-site'];
    if (site && site !== 'same-origin' && site !== 'none')
        return false;
    return !!(h['x-work-wsid'] !== undefined || site === 'same-origin' || h.origin);
}

function deny(item, name, params, reason) {
    audit('deny', { path: item?.path, method: name, reason, params });
    throw new Error(ACCESS_DENIED);
}

/** Может ли субъект читать элемент (для фильтрации списков и проверки уровня read). */
export async function canRead(item, params) {
    if (!(item instanceof FS.$folder))
        return true;
    if (item instanceof FS.$class)
        return !!(await item.allowAccess(params));
    try {
        await item.assertAccess(params, FS.$class.ACCESS_LEVEL.READ);
        return true;
    }
    catch {
        return false;
    }
}

/** Проверить уровень до вызова. */
export async function authorize(item, name, level, params, ctx = {}) {
    const uid = FS.$class.resolveUid(params);
    const needsCsrf = level === L.CALL || level === L.WRITE || level === L.ADMIN;
    // подписанный запрос узла сети — намерение доказано подписью, cookie не участвуют
    const signed = params?.session?.principal?.kind === 'node';
    if (needsCsrf && ctx.transport === 'http' && !signed && !isSameOriginRequest(ctx.request))
        deny(item, name, params, 'csrf');
    switch (level) {
        case L.PUBLIC:
            return;
        case L.USER:
            if (!uid && params?.session)
                deny(item, name, params, 'anonymous');
            return;
        case L.READ:
        case L.CALL:
            if (!(await canRead(item, params)))
                deny(item, name, params, 'read');
            return;
        case L.WRITE:
            if (!uid && params?.session && params.session.$user !== globalThis.WORK)
                deny(item, name, params, 'anonymous');
            return;
        case L.ADMIN:
            try {
                await item.assertAccess(params, FS.$class.ACCESS_LEVEL.ADMIN);
            }
            catch {
                deny(item, name, params, 'admin');
            }
            audit('admin', { path: item?.path, method: name, params });
            return;
        default:
            deny(item, name, params, 'level');
    }
}

/**
 * Вызвать член элемента от имени субъекта params.session.
 * @param {object} item
 * @param {string} name Метод или свойство
 * @param {object} params Параметры вызова (session, role, …)
 * @param {object} [ctx] {transport: 'http'|'agent'|'node', request, post}
 */
export async function invoke(item, name, params = {}, ctx = {}) {
    const member = resolveMember(item, name);
    if (!member) {
        if (name && name in (item || {}))
            deny(item, name, params, 'not exposed');
        throw new Error(`Unknown method "${name}" for:<br>${item?.path}`);
    }
    await authorize(item, name, member.level, params, ctx);
    return member.call(params, ctx.post);
}

/** Проверить шаги пути `@свойство` (get_item отдаёт item[prop]) — только разрешённые на чтение. */
export function assertPathProps(path) {
    for (const raw of String(path || '').split('/')) {
        if (raw[0] !== '@')
            continue;
        const name = raw.slice(1);
        if (!name)
            continue;
        if (!NAME_RE.test(name) || name[0] === '_' || DENY.has(name))
            throw new Error(ACCESS_DENIED);
        const level = MEMBERS[name];
        if (level) {
            if (level !== L.READ && level !== L.PUBLIC)
                throw new Error(ACCESS_DENIED);
            continue;
        }
        // не объявленный метод ядра — запрещён; геттер — чтение; иное имя — ребёнок `@…` или член class.js
        if (coreMemberKind(name) === 'method')
            throw new Error(ACCESS_DENIED);
    }
}

function coreMemberKind(name) {
    for (const C of [FS.$class, FS.$file, FS.$user, FS.$node, globalThis.$server]) {
        let p = C?.prototype;
        while (p && p !== Object.prototype) {
            const d = Object.getOwnPropertyDescriptor(p, name);
            if (d)
                return d.get ? 'getter' : 'method';
            p = Object.getPrototypeOf(p);
        }
    }
    return null;
}

/** Оставить в списке только видимое субъекту. */
export async function visibleOnly(list, params) {
    if (!Array.isArray(list) || !params?.session)
        return list;
    const out = [];
    for (const it of list)
        if (await canRead(it, params))
            out.push(it);
    return out;
}
