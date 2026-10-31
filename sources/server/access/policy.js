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
 *  - ADMIN меняет систему в точке назначения и ниже, читает секреты и все логи.
 *  - BOSS видит систему и логи в точке назначения и ниже, систему не меняет.
 *  - Остальные роли читают систему своей точки, пишут только в свою зону,
 *    видят только собственные логи из личного кабинета.
 *  - Лента определяет, что пользователю показали (индекс лент — access/refs.js).
 */

/** Области внутри точки. */
export const AREA = Object.freeze({
    SYSTEM: 'system',
    FILES: 'files',
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

/** Системные папки и файлы внутри метапапки, изменять которые может только ADMIN. */
export const SYSTEM_META_NAMES = Object.freeze([
    'class.js',
    'readme.md',
    'handlers',
    'methods',
    'triggers',
    'timers',
    'hooks',
    'logs',
    'DATA',
    'INDEX',
]);

/**
 * Системные роли: ADMIN и BOSS. Поведение зашито в коде (canRead/canWrite):
 * ADMIN — меняет систему в точке назначения и ниже, читает секреты и все логи;
 * BOSS — видит систему и логи в точке назначения и ниже, систему не меняет.
 * Остальные роли (USER, GUEST, CUSTOMER, …) объявляются в `ROLES` class.js
 * слоя типа/класса и собираются по `~` вместе с остальным class.js:
 * читают систему своей точки, пишут только в свою ролевую папку,
 * видят только собственные логи из личного кабинета.
 * Ключ назначений в `#security` — id роли (массив uid).
 */
export const BASE_ROLES = Object.freeze({
    ADMIN: Object.freeze({ id: 'ADMIN', label: 'Администратор', icon: '', color: '', principals: Object.freeze(['user']) }),
    BOSS: Object.freeze({ id: 'BOSS', label: 'Руководитель', icon: '', color: '', principals: Object.freeze(['user']) }),
    USER: Object.freeze({ id: 'USER', label: 'Исполнитель', icon: '', color: '', principals: Object.freeze(['user', 'node']) }),
    GUEST: Object.freeze({ id: 'GUEST', label: 'Гость', icon: '', color: '', principals: Object.freeze(['user', 'node']) }),
});

/** Системная ли роль (поведение из кода, а не из данных). */
export function isSystemRole(id) {
    return id === 'ADMIN' || id === 'BOSS';
}

/** Видит ли роль ленту точки целиком (иначе — только свои записи). */
export function seesFullFeed(role) {
    const id = role?.id;
    return id === 'ADMIN' || id === 'BOSS' || id === 'OWNER';
}

/** Виды субъектов: пользователь этого сервера | узел сети WORK (другой сервер и его представители). */
export const PRINCIPALS = Object.freeze(['user', 'node']);

/** Порядок ролей «по силе»: ADMIN, BOSS, затем остальные в порядке объявления. */
export const BASE_ORDER = Object.freeze(['ADMIN', 'BOSS', 'USER', 'GUEST']);

/** Имя роли — заглавные латиница/цифры/подчёркивание (совпадает с именем папки зоны). */
export function isRoleId(id) {
    return typeof id === 'string' && /^[A-Z][A-Z0-9_]*$/.test(id);
}

/**
 * Нормализовать объявление ролей: скелет из BASE_ROLES + ROLES из class.js.
 * В данных — только внешний вид (label, icon, color) и субъекты (principals);
 * поведение системных ролей — в коде и данными не меняется.
 * @param {object} [declared] DATA.ROLES
 * @returns {Record<string, {id, label, icon, color, principals}>}
 */
export function normalizeRoles(declared) {
    const out = Object.create(null);
    for (const id of Object.keys(BASE_ROLES))
        out[id] = BASE_ROLES[id];
    if (!declared || typeof declared !== 'object')
        return out;
    for (const [id, raw] of Object.entries(declared)) {
        if (!isRoleId(id) || raw == null || raw === false)
            continue;
        if (RESERVED_ZONE_NAMES.includes(id))
            continue;
        const base = out[id] || { id, label: id, icon: '', color: '', principals: PRINCIPALS };
        const r = typeof raw === 'object' ? raw : {};
        // системные роли держат только пользователи — данными не расширить
        const principals = isSystemRole(id) ? ['user']
            : (Array.isArray(r.principals) ? r.principals.filter(p => PRINCIPALS.includes(p)) : [...base.principals]);
        out[id] = Object.freeze({
            id,
            label: typeof r.label === 'string' && r.label ? r.label : base.label,
            icon: typeof r.icon === 'string' ? r.icon : (base.icon || ''),
            color: typeof r.color === 'string' ? r.color : (base.color || ''),
            principals: Object.freeze(principals),
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
    if (first === '#secret' || first === '#system' || first[0] === '#')
        return { kind: AREA.SECRET };
    const ids = roleIds instanceof Set ? roleIds : new Set(roleIds || []);
    if (ids.has(first))
        return { kind: AREA.ZONE, role: first };
    if (first[0] === '$' || SYSTEM_META_NAMES.includes(first))
        return { kind: AREA.SYSTEM };
    if (first === 'ai') {
        if (segments.length === 2 && segments[1] === 'memory.md')
            return { kind: AREA.FILES };
        return { kind: AREA.SYSTEM };
    }
    if (segments.at(-1) === 'class.js')
        return { kind: AREA.SYSTEM };
    return { kind: AREA.FILES };
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
 * ADMIN — всё, включая секреты. BOSS — всё, кроме секретов.
 * Остальные: система/DATA/INDEX точки — да; своя зона — да;
 * лента — только свои записи; секреты — нет.
 * @param {object} role Нормализованное объявление роли
 * @param {{kind, role?}} area
 * @param {object} [opts]
 * @param {boolean} [opts.ownEntry] Запись ленты принадлежит пользователю
 * @param {boolean} [opts.logsContainer] Папка ленты/дня (листинг), не запись
 */
export function canRead(role, area, opts = {}) {
    if (!role || !area)
        return false;
    if (role.id === 'ADMIN')
        return true;
    if (area.kind === AREA.SECRET)
        return false;
    if (role.id === 'BOSS')
        return true;
    switch (area.kind) {
        case AREA.SYSTEM:
        case AREA.FILES:
        case AREA.DATA:
        case AREA.INDEX:
            return true;
        case AREA.ZONE:
            return area.role === role.id;
        case AREA.LOGS:
            return !!(opts.logsContainer || opts.ownEntry);
        default:
            return false;
    }
}

/**
 * Право записи области ролью.
 * ADMIN — всё. Остальные — общее хранилище файлов точки (AREA.FILES) и своя зона,
 * только там, где роль назначена локально, и никогда — системные метаданные (opts.executable).
 * @param {object} role Нормализованное объявление роли
 * @param {{kind, role?}} area
 * @param {object} [opts]
 * @param {boolean} [opts.local] Роль назначена в этой точке (не унаследована сверху)
 */
export function canWrite(role, area, opts = {}) {
    if (!role || !area)
        return false;
    if (role.id === 'ADMIN')
        return true;
    if (!opts.local || opts.executable)
        return false;
    if (area.kind === AREA.FILES)
        return true;
    return area.kind === AREA.ZONE && area.role === role.id;
}

/**
 * Является ли путь системными метаданными точки (class.js, readme.md, $folder/$class/$handler/…,
 * #system/#secret, handlers/methods/triggers/timers/hooks/ai кроме memory.md),
 * которые не-админы менять не могут.
 */
export function isSystemMetaPath(path, pointPath = '') {
    const p = String(path || '');
    const base = String(pointPath || '');
    const rest = base && (p === base || p.startsWith(base + '/')) ? p.slice(base.length) : p;
    const rawSegs = rest.split('/').filter(Boolean);
    if (!rawSegs.length)
        return true;
    // Вне метапапки точки ($…) — системное дерево точки
    if (rawSegs[0][0] !== '$')
        return true;
    // Типизаторы хендлеров/методов/триггеров/таймеров/файлов внутри метапапки — всегда системные метаданные
    if (rawSegs.slice(1).some(s => s[0] === '#' || ['$handler', '$method', '$trigger', '$timer', '$file'].includes(s)))
        return true;
    const segs = tildeSegments(path, pointPath);
    if (!segs.length) {
        // Если путь заканчивается на распределяемый системный слой ($folder / $class) — это системная папка
        return rawSegs.length > 1;
    }
    if (segs.some(s => s[0] === '#'))
        return true;
    if (segs.at(-1) === 'class.js')
        return true;
    if (SYSTEM_META_NAMES.includes(segs[0]))
        return true;
    if (isAgentControlPath(path, pointPath))
        return true;
    return false;
}

/**
 * Путь исполняемый/системный: class.js (сервер импортирует его как модуль),
 * сегменты `#…` (секреты, настройки), системные метаданные. Писать такие пути может только ADMIN.
 */
export function isExecutablePath(path, pointPath = '') {
    const segs = tildeSegments(path, pointPath);
    const name = String(path || '').split('/').pop();
    if (name === 'class.js' || segs.some(s => s[0] === '#'))
        return true;
    if (pointPath && isSystemMetaPath(path, pointPath))
        return true;
    return false;
}

/**
 * Пути, которые движок агента исполняет или загружает как инструкции/конфиг: `ai/` внутри метапапки
 * (кроме личной памяти memory.md), `hooks/`, `triggers/`. Писать их может только системная область.
 */
export function isAgentControlPath(path, pointPath = '') {
    const segs = tildeSegments(path, pointPath);
    for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        if (s === 'hooks' || s === 'triggers')
            return true;
        if (s === 'ai') {
            const rest = segs.slice(i + 1);
            if (rest.length === 1 && rest[0] === 'memory.md')
                continue;   // память — данные пользователя (tools/memory.js)
            return true;
        }
    }
    return false;
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
