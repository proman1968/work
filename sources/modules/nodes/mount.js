/**
 * Монтирование удалённых элементов узла федерации внутри `/NODES/<Узел>` (P2.3):
 *  - Разрешение ролей представителя текущего пользователя на узле (`/NODES/<Узел>`);
 *  - Построение дерева доступных точек из `remote.grants` (или корневых элементов узла) внутри `/NODES/<Узел>`;
 *  - Прозрачное проксирование чтения (`info`, `load`, `readme_merged`, `logs`, `db_*`) и действий
 *    на удалённый сервер через подписанный `nodeFetch` (`work-node/1`) с переписыванием путей
 *    под префикс `/NODES/<Узел>/...`, чтобы любые доступные элементы узла открывались
 *    в штатных вкладках нашего проводника ODA (`work-form`).
 */
import { DEV_MODE } from '../../host/config.js';
import { nodeFetch } from './outbound.js';
import { audit } from '../../server/access/audit.js';

const ACCESS_DENIED = 'Доступ запрещён';
const REMOTE_INFO_TTL_MS = 4_000;

/** Нормализовать удалённый путь (`/a/b`, без хвостового слэша, корень — `/`). */
export function normalizeRemotePath(p) {
    let s = '/' + String(p || '/').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
    if (s === '')
        s = '/';
    return s;
}

/** Снять префикс `/NODES/<nodeId>` со строки пути, если он есть. */
export function stripNodePrefix(value, nodePrefix) {
    if (typeof value !== 'string' || !nodePrefix)
        return value;
    if (value === nodePrefix)
        return '/';
    if (value.startsWith(nodePrefix + '/'))
        return value.slice(nodePrefix.length) || '/';
    return value;
}

/** Добавить префикс `/NODES/<nodeId>` к абсолютному пути удалённого сервера. */
export function addNodePrefix(remotePath, nodePrefix) {
    if (typeof remotePath !== 'string' || !nodePrefix)
        return remotePath;
    if (remotePath.startsWith(nodePrefix + '/') || remotePath === nodePrefix)
        return remotePath;
    if (remotePath === '/' || remotePath === '')
        return nodePrefix;
    if (remotePath.startsWith('/'))
        return nodePrefix + remotePath;
    return remotePath;
}

/** Рекурсивно снять префикс `/NODES/<nodeId>` во входных параметрах запроса к удалённому узлу. */
export function unwrapRemoteParams(params, nodePrefix) {
    if (!params || typeof params !== 'object')
        return params;
    const SKIP = new Set(['session', '$context', 'request']);
    const out = {};
    for (const [k, v] of Object.entries(params)) {
        if (SKIP.has(k))
            continue;
        if (typeof v === 'string') {
            out[k] = stripNodePrefix(v, nodePrefix);
        }
        else if (Array.isArray(v)) {
            out[k] = v.map(x => typeof x === 'string' ? stripNodePrefix(x, nodePrefix) : x);
        }
        else {
            out[k] = v;
        }
    }
    return out;
}

/**
 * Переписать пути в ответе `info` удалённого узла под префикс `/NODES/<nodeId>`.
 */
export function rewriteRemoteInfo(data, nodePrefix, fallbackRemotePath = '/') {
    if (!data || typeof data !== 'object')
        return data;
    if (Array.isArray(data))
        return data.map(item => rewriteRemoteInfo(item, nodePrefix));
    const remotePath = normalizeRemotePath(data.path || fallbackRemotePath);
    const localPath = addNodePrefix(remotePath, nodePrefix);
    const out = {
        ...data,
        path: localPath,
        remotePath,
        isRemote: true,
    };
    for (const listKey of ['items', 'entries', 'files', 'folders', 'children']) {
        if (Array.isArray(data[listKey])) {
            out[listKey] = data[listKey].map(ch => {
                const childRemote = ch?.path
                    ? normalizeRemotePath(ch.path)
                    : normalizeRemotePath((remotePath === '/' ? '' : remotePath) + '/' + (ch?.id || ''));
                return rewriteRemoteInfo(ch, nodePrefix, childRemote);
            });
        }
    }
    return out;
}

/**
 * Переписать пути классов в ответах учётного ядра (`db_schema`, `db_query`, `db_sheet`, `db_card`, `db_turnovers`, `db_journal`, `db_entry`, `db_members`, `db_choices`, `db_scope`)
 * так, чтобы ссылки (`targetPath`, `paths`, `create`, `registry.path`) указывали внутрь `/NODES/<nodeId>/...`.
 */
export function rewriteRemoteDataResult(res, nodePrefix) {
    if (!res || typeof res !== 'object' || !nodePrefix)
        return res;
    if (Array.isArray(res))
        return res.map(x => rewriteRemoteDataResult(x, nodePrefix));
    const out = { ...res };
    if (out.schema && typeof out.schema === 'object') {
        const s = { ...out.schema };
        if (typeof s.path === 'string')
            s.path = addNodePrefix(s.path, nodePrefix);
        const mapField = f => {
            if (!f || typeof f !== 'object')
                return f;
            const nf = { ...f };
            if (typeof nf.targetPath === 'string')
                nf.targetPath = addNodePrefix(nf.targetPath, nodePrefix);
            if (typeof nf.target === 'string' && nf.target.startsWith('/'))
                nf.target = addNodePrefix(nf.target, nodePrefix);
            if (typeof nf.catalog === 'string' && nf.catalog.startsWith('/'))
                nf.catalog = addNodePrefix(nf.catalog, nodePrefix);
            if (Array.isArray(nf.fields))
                nf.fields = nf.fields.map(mapField);
            return nf;
        };
        if (Array.isArray(s.fields))
            s.fields = s.fields.map(mapField);
        if (Array.isArray(s.overlay))
            s.overlay = s.overlay.map(mapField);
        if (Array.isArray(s.slots))
            s.slots = s.slots.map(mapField);
        if (Array.isArray(s.leaves))
            s.leaves = s.leaves.map(l => l && typeof l.path === 'string' ? { ...l, path: addNodePrefix(l.path, nodePrefix) } : l);
        if (s.classes && typeof s.classes === 'object') {
            const nextClasses = {};
            for (const [k, c] of Object.entries(s.classes)) {
                nextClasses[k] = (c && typeof c.path === 'string')
                    ? { ...c, path: addNodePrefix(c.path, nodePrefix) }
                    : c;
            }
            s.classes = nextClasses;
        }
        out.schema = s;
    }
    if (out.names && typeof out.names === 'object' && out.names.paths && typeof out.names.paths === 'object') {
        const nextPaths = {};
        for (const [k, p] of Object.entries(out.names.paths))
            nextPaths[k] = typeof p === 'string' ? addNodePrefix(p, nodePrefix) : p;
        out.names = { ...out.names, paths: nextPaths };
    }
    if (out.registry && typeof out.registry === 'object' && typeof out.registry.path === 'string') {
        out.registry = { ...out.registry, path: addNodePrefix(out.registry.path, nodePrefix) };
    }
    if (Array.isArray(out.create)) {
        out.create = out.create.map(c => (c && typeof c.path === 'string') ? { ...c, path: addNodePrefix(c.path, nodePrefix) } : c);
    }
    if (out.operation && typeof out.operation === 'object' && typeof out.operation.path === 'string') {
        out.operation = { ...out.operation, path: addNodePrefix(out.operation.path, nodePrefix) };
    }
    return out;
}

/**
 * Определить роли представителя на узле `nodeRoot`, доступные вызывающему `params`.
 */
export async function resolveMountRoles(nodeRoot, params = {}) {
    await nodeRoot.init;
    const declared = nodeRoot._declaredRolesSync();
    const nonSystemRoles = Object.keys(declared).filter(r => r !== 'ADMIN' && r !== 'BOSS');
    const grantRoles = (nodeRoot.DATA?.remote?.grants || [])
        .map(g => g?.role)
        .filter(r => r && r !== 'ADMIN' && r !== 'BOSS');

    const uid = nodeRoot.constructor.resolveUid(params);
    const isAdmin = DEV_MODE
        || !params?.session
        || params.session.$user === globalThis.WORK
        || (await nodeRoot._isWorkAdmin(params).catch(() => false))
        || (await nodeRoot.roles(params).catch(() => [])).includes('ADMIN');

    if (isAdmin) {
        return [...new Set([...grantRoles, ...nonSystemRoles, 'USER'])];
    }
    if (!uid || params.session?.principal?.kind === 'node')
        return [];

    const assigned = [];
    for (const r of [...new Set([...grantRoles, ...nonSystemRoles])]) {
        if (nodeRoot._roleIds(r, declared).includes(uid) || nodeRoot._roleIds(r, declared).includes('GUEST'))
            assigned.push(r);
    }
    if (!assigned.includes('USER') && await nodeRoot._isPlaceMember(uid))
        assigned.push('USER');
    return assigned;
}

/**
 * Выбрать роль представителя для обращения к `remotePath` на узле `nodeRoot`.
 */
export async function pickRoleForRemotePath(nodeRoot, remotePath, params = {}) {
    const allowedRoles = await resolveMountRoles(nodeRoot, params);
    if (!allowedRoles.length)
        return null;
    if (params.as && allowedRoles.includes(params.as))
        return params.as;
    const clean = normalizeRemotePath(remotePath);
    const grants = Array.isArray(nodeRoot.DATA?.remote?.grants) ? nodeRoot.DATA.remote.grants : [];
    // Ищем наиболее специфичный grant, покрывающий remotePath и доступный пользователю
    let bestGrant = null;
    for (const g of grants) {
        if (!g?.point || !g?.role || !allowedRoles.includes(g.role))
            continue;
        const gp = normalizeRemotePath(g.point);
        if (clean === gp || gp === '/' || clean.startsWith(gp + '/')) {
            if (!bestGrant || gp.length > normalizeRemotePath(bestGrant.point).length)
                bestGrant = g;
        }
    }
    if (bestGrant)
        return bestGrant.role;
    return allowedRoles[0];
}

/**
 * Выполнить подписанный запрос к удалённому узлу от имени текущего пользователя и выбранной роли.
 */
export async function callMountedRemote(nodeRoot, remotePath, method = 'info', params = {}, post = undefined) {
    await nodeRoot.init;
    if (nodeRoot.DATA?.status && nodeRoot.DATA.status !== 'active')
        throw new Error('Узел не активен: ' + nodeRoot.DATA.status);
    if (!nodeRoot.DATA?.origin || !nodeRoot.DATA?.host_id)
        throw new Error('У узла не заданы origin или host_id');

    const role = await pickRoleForRemotePath(nodeRoot, remotePath, params);
    if (!role)
        throw new Error(ACCESS_DENIED);

    const uid = nodeRoot.constructor.resolveUid(params) || (DEV_MODE ? (globalThis.WORK?.id || 'dev') : '');
    const session = params?.session;
    const args = unwrapRemoteParams(params, nodeRoot.path);
    delete args.as;

    audit('node_out', { node: nodeRoot.principalId, as: role, path: remotePath, method, params });
    return nodeFetch(nodeRoot.DATA, {
        path: normalizeRemotePath(remotePath),
        method,
        params: args,
        post: post ?? params?.post,
        actor: uid,
        actorLabel: session?.$user?.label,
        roles: [role],
    });
}
