/**
 * Политика доступа WORK — чистые правила без ввода-вывода.
 * Единый источник правды для ядра ($class.canSee / canWrite) и RAG.
 *
 * Модель «Точки × Роли × Ленты»:
 *  - Размещение определяет наследование (слои `~`), права о нём не знают.
 *    У любого файла — собственного или унаследованного — есть область внутри точки:
 *    первая папка после последнего типизирующего сегмента (`$…`) виртуального пути.
 *  - Область: имя объявленной роли → зона этой роли; `logs` → лента точки;
 *    `DATA` → объекты (пишет только API класса); `INDEX` → производные агрегаты;
 *    `#secret` / `#system` → секреты; всё остальное → система.
 *  - Роль определяет охват и права: scope (point|subtree), feed (own|point), write (zone|all).
 *  - Лента определяет, что пользователю показали (индекс лент — access/refs.js).
 */

/** Области внутри точки. */
export const AREA = Object.freeze({
    SYSTEM: 'system',
    ZONE: 'zone',
    LOGS: 'logs',
    /** Объекты `.data`: читает видевший класс, пишет API класса или write=all. */
    DATA: 'data',
    /** Производные агрегаты: читаются через методы, пересобираются из DATA. */
    INDEX: 'index',
    SECRET: 'secret',
    /** Элемент вложенного класса — оценивается политикой этого класса. */
    NESTED: 'nested',
});

/** Системные имена папок метапапки: ролью их объявить нельзя, зону не образуют. */
export const RESERVED_ZONE_NAMES = Object.freeze(['DATA', 'INDEX', 'logs']);

/**
 * Базовые роли. Прикладные роли объявляются в `ROLES` class.js слоя типа/класса
 * и собираются по `~` вместе с остальным class.js.
 * key — поле назначений в `#security` (массив uid).
 */
export const BASE_ROLES = Object.freeze({
    ADMIN: Object.freeze({ id: 'ADMIN', key: 'ADMINS', label: 'Администратор', scope: 'subtree', feed: 'point', write: 'all', principals: Object.freeze(['user']) }),
    BOSS: Object.freeze({ id: 'BOSS', key: 'BOSSES', label: 'Руководитель', scope: 'subtree', feed: 'point', write: 'zone', principals: Object.freeze(['user']) }),
    USER: Object.freeze({ id: 'USER', key: 'USERS', label: 'Исполнитель', scope: 'point', feed: 'own', write: 'zone', principals: Object.freeze(['user', 'node']) }),
    GUEST: Object.freeze({ id: 'GUEST', key: 'GUESTS', label: 'Гость', scope: 'point', feed: 'own', write: 'zone', principals: Object.freeze(['user', 'node']) }),
});

/** Виды субъектов: пользователь этого сервера | узел сети WORK (другой сервер и его представители). */
export const PRINCIPALS = Object.freeze(['user', 'node']);

/** Порядок ролей «по силе»: базовые, затем прикладные в порядке объявления. */
export const BASE_ORDER = Object.freeze(['ADMIN', 'BOSS', 'USER', 'GUEST']);

const SCOPES = new Set(['point', 'subtree']);
const FEEDS = new Set(['own', 'point']);
const WRITES = new Set(['zone', 'all', 'none']);

/** Имя роли — заглавные латиница/цифры/подчёркивание (совпадает с именем папки зоны). */
export function isRoleId(id) {
    return typeof id === 'string' && /^[A-Z][A-Z0-9_]*$/.test(id);
}

/**
 * Нормализовать объявление ролей: базовые + ROLES из class.js.
 * Прикладная роль по умолчанию ведёт себя как USER.
 * @param {object} [declared] DATA.ROLES
 * @returns {Record<string, {id, key, label, scope, feed, write}>}
 */
export function normalizeRoles(declared) {
    const out = Object.create(null);
    for (const id of BASE_ORDER)
        out[id] = BASE_ROLES[id];
    if (!declared || typeof declared !== 'object')
        return out;
    for (const [id, raw] of Object.entries(declared)) {
        if (!isRoleId(id) || raw == null || raw === false)
            continue;
        if (RESERVED_ZONE_NAMES.includes(id))
            continue;
        const base = out[id] || { id, key: id + 'S', label: id, scope: 'point', feed: 'own', write: 'zone', principals: PRINCIPALS };
        const r = typeof raw === 'object' ? raw : {};
        let principals = Array.isArray(r.principals) ? r.principals.filter(p => PRINCIPALS.includes(p)) : base.principals;
        // узел сети никогда не получает write=all
        const write = WRITES.has(r.write) ? r.write : base.write;
        if (write === 'all')
            principals = principals.filter(p => p !== 'node');
        out[id] = Object.freeze({
            id,
            key: typeof r.key === 'string' && r.key ? r.key : base.key,
            label: typeof r.label === 'string' && r.label ? r.label : base.label,
            scope: SCOPES.has(r.scope) ? r.scope : base.scope,
            feed: FEEDS.has(r.feed) ? r.feed : base.feed,
            write,
            principals: Object.freeze([...principals]),
        });
    }
    return out;
}

/** Порядок ролей по силе для списка id. */
export function orderRoles(ids, declared) {
    const all = Object.keys(declared || BASE_ROLES);
    return [...ids].sort((a, b) => rank(a, all) - rank(b, all));
}

function rank(id, all) {
    const i = BASE_ORDER.indexOf(id);
    if (i >= 0)
        return i;
    const j = all.indexOf(id);
    return BASE_ORDER.length + (j >= 0 ? j : all.length);
}

/**
 * Область по сегментам пути внутри слоя (после последнего `$…`).
 * @param {string[]} segments Например ['USER', 'text', 'a.md'] или ['logs', '2026-09-28', 'x.logs']
 * @param {Iterable<string>} roleIds Объявленные роли точки
 * @returns {{kind: string, role?: string}}
 */
export function areaOfSegments(segments, roleIds) {
    const first = segments?.[0];
    if (!first)
        return { kind: AREA.SYSTEM };
    if (first === 'logs')
        return { kind: AREA.LOGS };
    if (first === 'DATA')
        return { kind: AREA.DATA };
    if (first === 'INDEX')
        return { kind: AREA.INDEX };
    if (first === '#secret' || first === '#system')
        return { kind: AREA.SECRET };
    const ids = roleIds instanceof Set ? roleIds : new Set(roleIds || []);
    if (ids.has(first))
        return { kind: AREA.ZONE, role: first };
    return { kind: AREA.SYSTEM };
}

/**
 * Сегменты пути после последнего типизирующего сегмента (`$…`) внутри точки.
 * Для элементов вне метапапки (собственное дерево точки) — [] → система.
 * @param {string} path Виртуальный путь элемента
 * @param {string} [pointPath] Путь точки (класса); сегменты до него не учитываются
 */
export function tildeSegments(path, pointPath = '') {
    const p = String(path || '');
    const base = String(pointPath || '');
    const rest = base && (p === base || p.startsWith(base + '/')) ? p.slice(base.length) : p;
    const segs = rest.split('/').filter(Boolean);
    let last = -1;
    for (let i = 0; i < segs.length; i++)
        if (segs[i][0] === '$')
            last = i;
    return last < 0 ? [] : segs.slice(last + 1);
}

/** Область элемента по виртуальному пути относительно точки. */
export function areaOfPath(path, pointPath, roleIds) {
    return areaOfSegments(tildeSegments(path, pointPath), roleIds);
}

/**
 * Право чтения области ролью.
 * @param {object} role Нормализованное объявление роли
 * @param {{kind, role?}} area
 * @param {object} [opts]
 * @param {boolean} [opts.ownEntry] Для LOGS при feed=own: запись принадлежит пользователю
 * @param {boolean} [opts.logsContainer] Для LOGS: папка ленты/дня (листинг), не запись
 */
export function canRead(role, area, opts = {}) {
    if (!role || !area)
        return false;
    if (area.kind === AREA.SECRET)
        return role.write === 'all';
    if (role.scope === 'subtree')
        return true;
    switch (area.kind) {
        case AREA.SYSTEM:
        case AREA.DATA:
        case AREA.INDEX:
            return true;
        case AREA.ZONE:
            return area.role === role.id;
        case AREA.LOGS:
            if (role.feed === 'point')
                return true;
            return !!(opts.logsContainer || opts.ownEntry);
        default:
            return false;
    }
}

/**
 * Право записи области ролью.
 * DATA/INDEX пишет только write=all (ADMIN) напрямую; остальные — через API класса
 * (create_object и т.п.), который сам проверяет права и пишет под системной сессией.
 * @param {object} role Нормализованное объявление роли
 * @param {{kind, role?}} area
 * @param {object} [opts]
 * @param {boolean} [opts.local] Роль назначена в этой точке (не унаследована сверху)
 */
export function canWrite(role, area, opts = {}) {
    if (!role || !area)
        return false;
    if (role.write === 'all')
        return true;
    if (role.write === 'none' || !opts.local || opts.executable)
        return false;
    return area.kind === AREA.ZONE && area.role === role.id;
}

/**
 * Путь исполняемый/системный: class.js (сервер импортирует его как модуль),
 * сегменты `#…` (секреты, настройки). Писать такие пути может только write=all.
 * Сегменты `$…` отдельно не нужны: после них область пересчитывается и становится системой.
 */
export function isExecutablePath(path, pointPath = '') {
    const segs = tildeSegments(path, pointPath);
    const name = String(path || '').split('/').pop();
    return name === 'class.js' || segs.some(s => s[0] === '#');
}

/** Запись ленты принадлежит пользователю: автор или получатель. */
export function isOwnLogRow(row, uid) {
    if (!row || !uid)
        return false;
    if (row.sender === uid)
        return true;
    const receivers = Array.isArray(row.receivers)
        ? row.receivers
        : typeof row.receivers === 'string' ? row.receivers.split(',').map(s => s.trim()) : [];
    return receivers.includes(uid);
}
