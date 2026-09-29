/**
 * Реестр узлов сети WORK — класс `/NODES`, узел — дочерний класс типа `$node`:
 *   host_id, origin, publicKey (закреплён при добавлении), fingerprint, status, announce,
 *   remote (карточка узла: роли, объявленные на нём; назначения нашего сервера у него),
 *   ROLES — роли удалённого сервера: в локальном классе узла на них назначаются наши
 *   представители (`#security.CUSTOMERS: [uid]` — представитель по закупкам у этого узла).
 */
import { fingerprint, PROTOCOL, wellKnown } from './identity.js';
import { serverId } from '../../host/server-id.js';

const CARD_MAX = 1024 * 1024;
let cache = null;

export function invalidateRegistry() {
    cache = null;
}

async function registryRoot() {
    let root = await globalThis.WORK.get_item('/NODES');
    if (Array.isArray(root))
        root = root[0];
    return root || null;
}

/** Узлы реестра: [{item, host_id, label, origin, publicKey, fingerprint, status, announce}]. */
export async function listNodes() {
    if (cache && Date.now() - cache.at < 60_000)
        return cache.list;
    const root = await registryRoot();
    const list = [];
    if (root) {
        const { FS } = await import('../../server/index.js');
        for (const child of (await root.items) || []) {
            if (!(child instanceof FS.$class))
                continue;
            await child.init;
            const d = child.DATA || {};
            if (!d.host_id)
                continue;
            list.push({
                item: child,
                host_id: String(d.host_id).toUpperCase(),
                label: d.label || child.id,
                origin: d.origin || '',
                publicKey: d.publicKey || '',
                fingerprint: d.fingerprint || (d.publicKey ? fingerprint(d.publicKey) : ''),
                status: d.status || (d.publicKey ? 'active' : 'pending'),
                announce: !!d.announce,
            });
        }
    }
    cache = { at: Date.now(), list };
    return list;
}

export async function findNode(hostId) {
    const id = String(hostId || '').toUpperCase();
    return (await listNodes()).find(n => n.host_id === id) || null;
}

/** Получить карточку узла по адресу (только для ADMIN: адрес может быть в локальной сети). */
export async function fetchCard(origin) {
    let url;
    try {
        url = new URL('/.well-known/work-node', String(origin));
    }
    catch {
        throw new Error('Недопустимый адрес узла');
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:')
        throw new Error('Адрес узла: только http/https');
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000), redirect: 'error' });
    if (!res.ok)
        throw new Error('Узел не ответил карточкой: HTTP ' + res.status);
    const text = await res.text();
    if (text.length > CARD_MAX)
        throw new Error('Карточка узла слишком большая');
    const card = JSON.parse(text);
    if (card?.protocol !== PROTOCOL || !/^[0-9A-F]{15}$/i.test(card.id || '') || !card.publicKey)
        throw new Error('Это не узел WORK (' + PROTOCOL + ')');
    card.fingerprint = fingerprint(card.publicKey);
    card.origin = url.origin;
    return card;
}

function rolesFrom(card) {
    const out = {};
    for (const r of card?.roles || [])
        if (/^[A-Z][A-Z0-9_]*$/.test(r?.id || '') && !['ADMIN', 'BOSS'].includes(r.id))
            out[r.id] = { label: r.label || r.id };
    return out;
}

/**
 * Добавить узел: карточка по адресу → сверка отпечатка ключа администратором → класс в /NODES.
 * @param {object} root Класс реестра
 * @param {object} params {origin, fingerprint (подтверждение), label?, announce?}
 */
export async function addNode(root, params = {}) {
    const card = await fetchCard(params.origin);
    if (card.id.toUpperCase() === serverId)
        throw new Error('Это наш собственный сервер');
    if (!params.fingerprint || String(params.fingerprint).toUpperCase() !== card.fingerprint)
        return { confirm: true, card: { id: card.id, label: card.label, origin: card.origin, fingerprint: card.fingerprint, roles: card.roles } };
    const existing = await findNode(card.id);
    if (existing)
        throw new Error('Узел уже в реестре: ' + existing.item.path);
    const { safeNodeName } = await import('../../server/safe-node-name.js');
    const id = safeNodeName(params.label || new URL(card.origin).host) || card.id;
    const data = {
        label: params.label || card.label || id,
        host_id: card.id.toUpperCase(),
        origin: card.origin,
        publicKey: card.publicKey,
        fingerprint: card.fingerprint,
        status: 'active',
        announce: !!params.announce,
        added: Date.now(),
        remote: { label: card.label, roles: card.roles || [], peers: card.peers || [], at: Date.now() },
        ROLES: rolesFrom(card),
    };
    const { $class } = (await import('../../server/index.js')).FS;
    const post = 'export default ' + $class.toScript(data);
    await root.create({ ...params, id, type: '$node', post });
    invalidateRegistry();
    return { added: (root.path || '') + '/' + id, fingerprint: card.fingerprint };
}

/**
 * Обновить карточку узла. Смена ключа не принимается молча: узел блокируется (key_changed)
 * до решения администратора.
 */
export async function refreshNode(item, params = {}) {
    await item.init;
    const d = item.DATA || {};
    const card = await fetchCard(d.origin);
    const patch = { remote: { label: card.label, roles: card.roles || [], peers: card.peers || [], at: Date.now() } };
    if (card.id.toUpperCase() !== String(d.host_id).toUpperCase())
        patch.status = 'id_changed';
    else if (card.publicKey !== d.publicKey)
        patch.status = 'key_changed';
    patch.ROLES = { ...(d.ROLES || {}), ...rolesFrom(card) };
    try {
        const { nodeFetch } = await import('./outbound.js');
        if ((patch.status || d.status) === 'active')
            patch.remote.grants = await nodeFetch({ ...d }, { path: '/', method: 'node_grants' });
    }
    catch (e) {
        patch.remote.grantsError = e.message;
    }
    const next = { ...d, ...patch };
    delete next.id;
    const { $class } = (await import('../../server/index.js')).FS;
    await item.save({ ...params, post: $class.toScript(next) });
    invalidateRegistry();
    return { status: next.status, remote: next.remote };
}

/**
 * Граф сети для визуализации: мы, узлы реестра, их объявленные соседи (до depth шагов).
 * @returns {Promise<{nodes: Array, edges: Array}>}
 */
export async function networkGraph({ depth = 2 } = {}) {
    const self = await wellKnown();
    const nodes = new Map([[self.id, { id: self.id, label: self.label, origin: self.origin, self: true, status: 'self', level: 0 }]]);
    const edges = [];
    const seenEdge = new Set();
    const edge = (from, to, kind) => {
        const key = [from, to].sort().join('|') + kind;
        if (from === to || seenEdge.has(key))
            return;
        seenEdge.add(key);
        edges.push({ from, to, kind });
    };
    let frontier = [];
    for (const n of await listNodes()) {
        nodes.set(n.host_id, { id: n.host_id, label: n.label, origin: n.origin, status: n.status, known: true, path: n.item.path, level: 1 });
        edge(self.id, n.host_id, 'peer');
        frontier.push(n);
    }
    for (let level = 2; level <= Math.max(1, Math.min(3, Number(depth) || 2)) && frontier.length; level++) {
        const next = [];
        await Promise.all(frontier.slice(0, 50).map(async n => {
            let card;
            try {
                card = await fetchCard(n.origin);
            }
            catch (e) {
                const v = nodes.get(n.host_id || n.id);
                if (v)
                    v.error = e.message;
                return;
            }
            for (const p of card.peers || []) {
                const pid = String(p.id || '').toUpperCase();
                if (!/^[0-9A-F]{15}$/.test(pid))
                    continue;
                if (!nodes.has(pid)) {
                    nodes.set(pid, { id: pid, label: p.label || pid, origin: p.origin, status: 'remote', level });
                    next.push({ id: pid, origin: p.origin });
                }
                edge(card.id.toUpperCase(), pid, 'peer');
            }
        }));
        frontier = next;
    }
    return { nodes: [...nodes.values()], edges };
}
