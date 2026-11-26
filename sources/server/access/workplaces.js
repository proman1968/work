/**
 * Прикладные роли подразделения ($structure и наследники: $base, $server).
 * Хранятся в `#security` класса:
 *   '#security': {
 *       BOSS: [...], USER: [...],
 *       LINKS: [{ id: '/ПУТЬ', access: 'none'|'read'|'write'|'create'|'delete', scope?: 'own'|'place'|'unit'|'all' }],
 *       ROLES: [{ id, label?, icon?, USERS: [...], LINKS: [...], ROLES: [...] }],
 *   }
 * 4-уровневая накопительная модель доступа RWCD (+ явный запрет `none`):
 *  - none   (0) — явный запрет (переопределяет унаследованное от родительской папки/класса право);
 *  - read   (1, R) — чтение данных и отчётов;
 *  - write  (2, W) — R + изменение существующих объектов и проведение/исправление/отмена операций;
 *  - create (3, C) — W + создание новых объектов и документов;
 *  - delete (4, D) — C + удаление и восстановление объектов.
 * Внутри одной роли права проваливаются вниз по дереву классов и могут быть переопределены
 * на любом дочернем классе вверх или вниз (вплоть до `none` — правило наиболее специфичного пути).
 * Между несколькими ролями права объединяются по максимуму.
 * Псевдо-пользователи в `USERS`:
 *  - 'USERS'  — все зарегистрированные (вошедшие) пользователи своего сервера;
 *  - 'GUESTS' — все внешние посетители (включая неавторизованных).
 * Также в `USERS` могут быть:
 *  - локальное подразделение/организация/проект ('/ORGANIZATIONS/...', '/PROJECTS/...');
 *  - удалённый сервер сети (host_id или '/NODES/<Узел>');
 *  - удалённый пользователь ('/NODES/<Узел>/USERS/<uid>' или '<uid>@<host_id>');
 *  - удалённое подразделение/организация ('/NODES/<Узел>/ORGANIZATIONS/...', '/NODES/<Узел>/PROJECTS/...').
 * Чистые функции поверх объекта `#security` (без ввода-вывода).
 */

/** Имена метапапок типов-структур (в них лежит class.js подразделения/организации/проекта). */
export const STRUCTURE_META_NAMES = Object.freeze(['$structure', '$base', '$project', '$server']);

/** Допустимые уровни доступа на ссылке (RWCD + явный запрет none). */
export const ACCESS_LEVELS = Object.freeze(['none', 'read', 'write', 'create', 'delete']);

/** Числовой ранг уровней доступа (включая системный admin). */
export const ACCESS_RANK = Object.freeze({
    none: 0,
    read: 1,
    write: 2,
    create: 3,
    delete: 4,
    admin: 5,
});

const ACCESS_ALIASES = Object.freeze({
    '0': 'none',
    '-': 'none',
    none: 'none',
    '1': 'read',
    r: 'read',
    read: 'read',
    '2': 'write',
    w: 'write',
    write: 'write',
    '3': 'create',
    c: 'create',
    create: 'create',
    '4': 'delete',
    d: 'delete',
    delete: 'delete',
});

/** Нормализовать значение уровня доступа в каноническую строку RWCD или null. */
export function normalizeAccess(raw) {
    if (raw === undefined || raw === null)
        return null;
    const key = String(raw).trim().toLowerCase();
    return ACCESS_ALIASES[key] || null;
}

/** Достаточен ли фактический уровень доступа `actual` для требуемого `required`. */
export function hasAccess(actual, required = 'read') {
    const reqRank = ACCESS_RANK[required] || 0;
    if (reqRank <= 0)
        return true;
    return (ACCESS_RANK[actual] || 0) >= reqRank;
}

/** Максимум из двух уровней доступа (admin > delete > create > write > read > none). */
export function maxAccess(a, b) {
    return (ACCESS_RANK[b] || 0) > (ACCESS_RANK[a] || 0) ? b : a;
}

/** Групповые псевдо-субъекты для назначения на рабочие места и в USER. */
export const PSEUDO_USERS = Object.freeze({
    USERS: 'USERS',
    GUESTS: 'GUESTS',
});

/** Проверка, является ли идентификатор групповым псевдо-субъектом. */
export function isPseudoUser(id) {
    return id === 'USERS' || id === 'GUESTS' || id === 'GUEST';
}

/** Проверка, является ли идентификатор путём структурного подразделения (/ORGANIZATIONS/...). */
export function isNodeSubject(id) {
    return typeof id === 'string' && id.startsWith('/') && !/^\/NODES(?:\/|$)/i.test(id);
}

/** Проверка, является ли идентификатор удалённым субъектом из /NODES/... */
export function isRemoteSubject(id) {
    return typeof id === 'string' && /^\/NODES\/[^/]+(?:\/.*)?$/i.test(id);
}

function normNodePath(p) {
    const s = String(p || '').trim().replace(/\\/g, '/').replace(/\/+$/, '');
    return s || '/';
}

function parseRemoteEntry(entry) {
    if (typeof entry !== 'string')
        return null;
    const norm = normNodePath(entry);
    const m = /^\/NODES\/([^/]+)(?:\/(.*))?$/i.exec(norm);
    if (!m)
        return null;
    const nodeSeg = m[1];
    const rest = m[2] ? '/' + m[2] : '';
    const userMatch = /^\/USERS\/([^/]+)$/i.exec(rest);
    if (userMatch)
        return { kind: 'remote-user', nodeSeg, nodePath: `/NODES/${nodeSeg}`, remoteUid: userMatch[1], rest };
    if (rest && /^\/(?:ORGANIZATIONS|PROJECTS)(?:\/|$)/i.test(rest))
        return { kind: 'remote-unit', nodeSeg, nodePath: `/NODES/${nodeSeg}`, remotePath: rest };
    return { kind: 'remote-node', nodeSeg, nodePath: `/NODES/${nodeSeg}`, rest };
}

/**
 * Сопоставление субъекта (uid строка/null или объект
 * `{ uid, nodePath, nodeOnly, remoteNodeId, remoteNodePath, remoteActor, remoteFromPath }`)
 * со списком назначенных USERS.
 */
export function matchesUserList(list, subject) {
    if (!Array.isArray(list) || !list.length)
        return false;
    if (subject && typeof subject === 'object' && !Array.isArray(subject)) {
        const {
            uid = null,
            nodePath = '',
            nodeOnly = false,
            remoteNodeId = '',
            remoteNodePath = '',
            remoteActor = '',
            remoteFromPath = '',
        } = subject;
        if (nodePath) {
            const target = normNodePath(nodePath);
            if (list.some(item => isNodeSubject(item) && normNodePath(item) === target))
                return true;
        }
        if (remoteNodeId || remoteNodePath) {
            const normRemoteNode = remoteNodePath ? normNodePath(remoteNodePath) : '';
            const normRemoteNodeId = String(remoteNodeId || '').trim().toUpperCase();
            const normActor = String(remoteActor || '').trim();
            const normFrom = remoteFromPath ? normNodePath(remoteFromPath) : '';
            const remoteNodeSeg = normRemoteNode ? normRemoteNode.split('/').filter(Boolean)[1] || '' : '';
            for (const item of list) {
                if (typeof item !== 'string' || !item)
                    continue;
                // Совпадение с узлом сети по host_id (principalId)
                if (normRemoteNodeId && item.toUpperCase() === normRemoteNodeId)
                    return true;
                // Совпадение по формату actor@host_id
                if (normActor && normRemoteNodeId && item.toUpperCase() === `${normActor}@${normRemoteNodeId}`.toUpperCase())
                    return true;
                // Совпадение по пути /NODES/<Узел>[/USERS/<uid> | /ORGANIZATIONS/...]
                const parsed = parseRemoteEntry(item);
                if (!parsed)
                    continue;
                const sameNode = (normRemoteNode && normNodePath(parsed.nodePath).toLowerCase() === normRemoteNode.toLowerCase())
                    || (normRemoteNodeId && parsed.nodeSeg.toUpperCase() === normRemoteNodeId)
                    || (remoteNodeSeg && parsed.nodeSeg.toLowerCase() === remoteNodeSeg.toLowerCase());
                if (!sameNode)
                    continue;
                if (parsed.kind === 'remote-node')
                    return true;
                if (parsed.kind === 'remote-user' && normActor && parsed.remoteUid === normActor)
                    return true;
                if (parsed.kind === 'remote-unit' && normFrom
                    && (normFrom === parsed.remotePath || normFrom.startsWith(parsed.remotePath + '/')))
                    return true;
            }
            // Для удалённого узла локальные псевдо-субъекты 'USERS' не подставляются —
            // только явное назначение узла/его пользователя/подразделения или 'GUESTS'.
            if (list.includes('GUESTS') || list.includes('GUEST'))
                return true;
            return false;
        }
        if (nodeOnly)
            return false;
        return matchesUserList(list, uid);
    }
    const uid = subject;
    if (list.includes('GUESTS') || list.includes('GUEST'))
        return true;
    if (!uid)
        return false;
    if (list.includes('USERS'))
        return true;
    return list.includes(uid);
}

/** Пути (trail) не-external ролей, в которые добавлено подразделение nodePath. */
export function nodePlaceTrails(security, nodePath) {
    if (!nodePath)
        return [];
    const { places } = normalizeSecurity(security);
    const subject = { nodePath, nodeOnly: true };
    return walkPlaces(places)
        .filter(({ node }) => !node.external && matchesUserList(node.USERS, subject))
        .map(({ trail }) => trailKey(trail));
}

/** Открыта ли точка для неавторизованных гостей (через USER или любое рабочее место ROLES). */
export function isOpenToGuests(security) {
    if (!security || typeof security !== 'object')
        return false;
    if (matchesUserList(security.USER, null))
        return true;
    const { places } = normalizeSecurity(security);
    return walkPlaces(places).some(({ node }) => matchesUserList(node.USERS, null));
}

/** Видимость данных по ссылке (docs/architecture-v2.md, Р8): свои объекты, своего места, подразделения с вложенными, все. */
export const LINK_SCOPES = Object.freeze(['own', 'place', 'unit', 'all']);

/** Нормализовать одну ссылку {id, access, scope?}; мусор — null, неизвестный scope отбрасывается (действует умолчание). */
export function normalizeLink(raw) {
    const id = String(raw?.id || '').trim().replace(/\/+$/, '');
    const access = normalizeAccess(raw?.access);
    if (!id.startsWith('/') || !access)
        return null;
    const scope = String(raw?.scope || '').trim();
    return LINK_SCOPES.includes(scope) ? { id, access, scope } : { id, access };
}

/**
 * Вычислить эффективную ссылку для пути `clsPath` внутри одного набора ссылок (одной роли или общих LINKS)
 * по правилу наиболее специфичного предка (longest prefix match).
 * Это позволяет переопределять унаследованное от папки право вверх или вниз (вплоть до `none`).
 * @returns {{ link: object, access: string, denied: boolean } | null}
 */
export function resolveLinkInSet(links, clsPath) {
    const p = normNodePath(clsPath);
    if (!p.startsWith('/') || !Array.isArray(links) || !links.length)
        return null;
    let best = null;
    let bestLen = -1;
    for (const l of links) {
        if (!l?.id)
            continue;
        const lid = normNodePath(l.id);
        if (p !== lid && !p.startsWith(lid + '/'))
            continue;
        if (lid.length > bestLen) {
            best = l;
            bestLen = lid.length;
        }
        else if (lid.length === bestLen && best) {
            // При совпадении путей в одном списке — более высокий ранг побеждает (или явный none при равенстве)
            if ((ACCESS_RANK[l.access] || 0) >= (ACCESS_RANK[best.access] || 0))
                best = l;
        }
    }
    if (!best)
        return null;
    return { link: best, access: best.access, denied: best.access === 'none' };
}

/**
 * Список путей строго ниже `basePath` в том же наборе ссылок, на которых эффективный уровень
 * строго ниже `minAccess` (например, явный запрет `none` или сужение до `read` при проверке `write`).
 */
export function deniedSubpathsInSet(links, basePath, minAccess = 'read') {
    const base = normNodePath(basePath);
    const out = [];
    for (const l of Array.isArray(links) ? links : []) {
        if (!l?.id)
            continue;
        const lid = normNodePath(l.id);
        if (!lid.startsWith(base + '/'))
            continue;
        if (!hasAccess(l.access, minAccess))
            out.push(lid);
    }
    return out;
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
            ...(r.external ? { external: true } : {}),
            ...(r.readonly ? { readonly: true } : {}),
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

/** Пути (trail) мест, на которые назначен uid (с учётом псевдо-субъектов USERS и GUESTS). */
export function memberTrailKeys(security, uid, { includeExternal = true } = {}) {
    const { places } = normalizeSecurity(security);
    return walkPlaces(places)
        .filter(({ node }) => (includeExternal || !node.external) && matchesUserList(node.USERS, uid))
        .map(({ trail }) => trailKey(trail));
}

/** Назначен ли uid хоть на одно внутреннее (не-external) рабочее место. */
export function isPlaceMember(security, uid) {
    return memberTrailKeys(security, uid, { includeExternal: false }).length > 0;
}

/** Назначен ли uid как внешний клиент (роль CLIENT в #security или место с external: true). */
export function isClientMember(security, uid) {
    if (matchesUserList(security?.CLIENT, uid))
        return true;
    const { places } = normalizeSecurity(security);
    return walkPlaces(places).some(({ node }) => Boolean(node.external) && matchesUserList(node.USERS, uid));
}

/** Назначен ли uid на место placeKey или на любое место выше него. */
export function isAncestorPlaceMember(security, uid, placeKey) {
    const key = String(placeKey || '');
    if (!key)
        return false;
    return memberTrailKeys(security, uid, { includeExternal: false }).some(m => key === m || key.startsWith(m + '/'));
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
 * Построить единый субъект проверки прав из `uid` и `params.session`
 * (учитывает локального пользователя, локальный вызов цифрового двойника и удалённый узел сети /NODES).
 */
export function buildSubject(uid, params = {}) {
    const twinFrom = params?.session?.twinCall?.fromPath || '';
    const nodeOnly = Boolean(params?.session?.twinRoleOnly);
    const principal = params?.session?.principal;
    if (principal?.kind === 'node') {
        const remoteActor = principal.actorId
            || (typeof principal.actor === 'string' && principal.actor.includes('@') ? principal.actor.split('@')[0] : '');
        return {
            uid,
            nodePath: twinFrom,
            nodeOnly,
            remoteNodeId: principal.id || '',
            remoteNodePath: principal.nodePath || params?.session?.$user?.path || '',
            remoteActor,
            remoteFromPath: principal.fromPath || twinFrom || '',
        };
    }
    return twinFrom ? { uid, nodePath: twinFrom, nodeOnly } : uid;
}

/**
 * Эффективные ссылки мест для пользователя: Map id → { access, via: [trailKey] }.
 * Свои ссылки места — своим access; ссылки вложенных мест — на чтение (кроме явного none).
 * @param {object} security Секция `#security`
 * @param {string|object} uid
 * @param {object} [opts]
 * @param {boolean} [opts.bossAll] BOSS: все ссылки всех мест — на чтение
 */
export function placeLinksFor(security, uid, opts = {}) {
    const { places } = normalizeSecurity(security);
    const eff = new Map();
    const add = (link, via) => {
        const cur = eff.get(link.id);
        const next = cur ? maxAccess(cur.access, link.access) : link.access;
        const seen = new Set(cur?.via || []);
        seen.add(via);
        eff.set(link.id, { access: next, via: [...seen] });
    };
    const all = walkPlaces(places);
    if (opts.bossAll)
        for (const { node, trail } of all)
            for (const l of node.LINKS)
                add({ id: l.id, access: l.access === 'none' ? 'none' : 'read' }, trailKey(trail));
    const mine = new Set(memberTrailKeys(security, uid));
    if (mine.size) {
        const under = key => [...mine].some(m => key === m || key.startsWith(m + '/'));
        for (const { node, trail } of all) {
            const key = trailKey(trail);
            if (!under(key))
                continue;
            const downgrade = !mine.has(key);
            for (const l of node.LINKS) {
                const effAccess = l.access === 'none' ? 'none' : (downgrade ? 'read' : l.access);
                add({ id: l.id, access: effAccess }, key);
            }
        }
    }
    return eff;
}

/** Общие ссылки подразделения (#security.LINKS) — для всех назначенных. */
export function commonLinks(security) {
    return normalizeSecurity(security).common;
}
