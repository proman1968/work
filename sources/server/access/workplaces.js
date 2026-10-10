/**
 * Прикладные роли подразделения ($structure и наследники: $base, $server).
 * Хранятся в `#security` класса:
 *   '#security': {
 *       ADMIN: [...], BOSS: [...], USER: [...], GUEST: [...],
 *       LINKS: [{ id: '/ПУТЬ', access: 'read'|'write' }],   // общие ссылки — всем назначенным
 *       ROLES: [{ id, label?, icon?, USERS: [...], LINKS: [...], ROLES: [...] }],  // дерево должностей
 *   }
 * Правила:
 *  - у прикладной роли нет зоны-папки и нет id системной роли (любой регистр, уникален в классе);
 *  - назначение на любую прикладную роль делает пользователя участником (USER) подразделения;
 *  - ссылка места действует своим access для его участников;
 *  - вышестоящее место видит ссылки вложенных мест, но только на чтение;
 *  - BOSS структуры видит ссылки всех мест на чтение.
 * Чистые функции поверх объекта `#security` (без ввода-вывода).
 */

/** Имена метапапок типов-структур (в них лежит class.js подразделения). */
export const STRUCTURE_META_NAMES = Object.freeze(['$structure', '$base', '$server']);

const RANK = { read: 1, write: 2 };

function maxAccess(a, b) {
    return (RANK[b] || 0) > (RANK[a] || 0) ? b : a;
}

/** Нормализовать одну ссылку {id, access}; мусор — null. */
export function normalizeLink(raw) {
    const id = String(raw?.id || '').trim();
    const access = String(raw?.access || '').trim();
    if (!id.startsWith('/') || (access !== 'read' && access !== 'write'))
        return null;
    return { id, access };
}

/** Нормализовать дерево прикладных ролей; мусор отбрасывается. */
export function normalizePlaces(raw, seen = new Set(), depth = 0) {
    if (!Array.isArray(raw) || depth > 10)
        return [];
    const out = [];
    for (const r of raw) {
        if (!r || typeof r !== 'object' || Array.isArray(r))
            continue;
        const id = String(r.id || '').trim();
        if (!id || seen.has(id))
            continue;
        seen.add(id);
        const links = [];
        for (const l of Array.isArray(r.LINKS) ? r.LINKS : []) {
            const n = normalizeLink(l);
            if (n)
                links.push(n);
        }
        out.push({
            id,
            label: typeof r.label === 'string' && r.label ? r.label : id,
            icon: typeof r.icon === 'string' ? r.icon : '',
            USERS: Array.isArray(r.USERS) ? r.USERS.filter(u => typeof u === 'string') : [],
            LINKS: links,
            ROLES: normalizePlaces(r.ROLES, seen, depth + 1),
        });
    }
    return out;
}

/** Нормализовать всю секцию `#security` подразделения: { common, places }. */
export function normalizeSecurity(security) {
    const common = [];
    for (const l of Array.isArray(security?.LINKS) ? security.LINKS : []) {
        const n = normalizeLink(l);
        if (n)
            common.push(n);
    }
    return { common, places: normalizePlaces(security?.ROLES) };
}

/**
 * Обход дерева мест: fn(node, trail), trail — массив id от корня к узлу.
 * @returns {Array<{node, trail: string[]}>}
 */
export function walkPlaces(places, trail = [], out = []) {
    for (const node of places || []) {
        const t = [...trail, node.id];
        out.push({ node, trail: t });
        walkPlaces(node.ROLES, t, out);
    }
    return out;
}

/** Строка пути места: ['heads','ceo'] → 'heads/ceo'. */
export function trailKey(trail) {
    return trail.join('/');
}

/** Пути (trail) мест, на которые назначен uid. */
export function memberTrailKeys(security, uid) {
    if (!uid)
        return [];
    const { places } = normalizeSecurity(security);
    return walkPlaces(places)
        .filter(({ node }) => node.USERS.includes(uid))
        .map(({ trail }) => trailKey(trail));
}

/** Назначен ли uid хоть на одно место. */
export function isPlaceMember(security, uid) {
    return memberTrailKeys(security, uid).length > 0;
}

/** Назначен ли uid на место placeKey или на любое место выше него. */
export function isAncestorPlaceMember(security, uid, placeKey) {
    const key = String(placeKey || '');
    if (!key)
        return false;
    return memberTrailKeys(security, uid).some(m => key === m || key.startsWith(m + '/'));
}

/** Все uid, назначенные на места подразделения (без дубликатов). */
export function placeUserIds(security) {
    const { places } = normalizeSecurity(security);
    const seen = new Set();
    for (const { node } of walkPlaces(places))
        for (const u of node.USERS)
            seen.add(u);
    return [...seen];
}

/** Есть ли назначения на места. */
export function hasPlaceAssignments(security) {
    if (!security || typeof security !== 'object')
        return false;
    const { places } = normalizeSecurity(security);
    return walkPlaces(places).some(({ node }) => node.USERS.length > 0);
}

/**
 * Эффективные ссылки мест для пользователя: Map id → { access, via: [trailKey] }.
 * Свои ссылки места — своим access; ссылки вложенных мест — на чтение.
 * @param {object} security Секция `#security`
 * @param {string} uid
 * @param {object} [opts]
 * @param {boolean} [opts.bossAll] BOSS: все ссылки всех мест — на чтение
 */
export function placeLinksFor(security, uid, opts = {}) {
    const { places } = normalizeSecurity(security);
    const eff = new Map();
    const add = (link, via) => {
        const cur = eff.get(link.id);
        const next = maxAccess(cur?.access, link.access);
        const seen = new Set(cur?.via || []);
        seen.add(via);
        eff.set(link.id, { access: next, via: [...seen] });
    };
    const all = walkPlaces(places);
    if (opts.bossAll)
        for (const { node, trail } of all)
            for (const l of node.LINKS)
                add({ id: l.id, access: 'read' }, trailKey(trail));
    const mine = new Set(memberTrailKeys(security, uid));
    if (mine.size) {
        const under = key => [...mine].some(m => key === m || key.startsWith(m + '/'));
        for (const { node, trail } of all) {
            const key = trailKey(trail);
            if (!under(key))
                continue;
            const downgrade = !mine.has(key);
            for (const l of node.LINKS)
                add({ id: l.id, access: downgrade ? 'read' : l.access }, key);
        }
    }
    return eff;
}

/** Общие ссылки подразделения (#security.LINKS) — для всех назначенных. */
export function commonLinks(security) {
    return normalizeSecurity(security).common;
}
