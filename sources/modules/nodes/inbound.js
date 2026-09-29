/**
 * Входящий подписанный запрос узла сети WORK → эфемерная сессия субъекта-узла.
 * Узел должен быть в нашем реестре (/NODES) со статусом active и закреплённым ключом;
 * подпись, адресат, время, одноразовость и хеш тела проверяются.
 * Субъект: {kind: 'node', id: host_id, actor: 'uid@host_id', roles: [заявленные]} —
 * права узла в нашем дереве, ограниченные заявленными ролями (представитель действует
 * только в той роли, в которой его назначил свой сервер).
 */
import { serverId } from '../../host/server-id.js';
import { verify } from './identity.js';
import { HEADERS, canonical, digestOf, MAX_SKEW_MS, rememberNonce } from './signing.js';
import { findNode } from './registry.js';
import { audit } from '../../server/access/audit.js';

const BODY_MAX = 64 * 1024 * 1024;
const ACCESS_DENIED = 'Доступ запрещён';

async function readRaw(request) {
    const chunks = [];
    let size = 0;
    for await (const c of request) {
        size += c.length;
        if (size > BODY_MAX)
            throw new Error('Тело запроса больше допустимого размера');
        chunks.push(c);
    }
    return Buffer.concat(chunks);
}

export async function verifyNodeRequest(request) {
    const h = request.headers;
    const nodeId = String(h[HEADERS.node] || '').toUpperCase();
    const fail = (reason) => {
        audit('node_reject', { node: nodeId, reason, url: request.url });
        throw new Error(ACCESS_DENIED);
    };
    if (!/^[0-9A-F]{15}$/.test(nodeId))
        fail('node id');
    if (String(h[HEADERS.audience] || '').toUpperCase() !== serverId)
        fail('audience');
    const date = String(h[HEADERS.date] || '');
    const t = Date.parse(date);
    if (!Number.isFinite(t) || Math.abs(Date.now() - t) > MAX_SKEW_MS)
        fail('date');
    const nonce = String(h[HEADERS.nonce] || '');
    if (nonce.length < 16 || nonce.length > 64)
        fail('nonce');
    const node = await findNode(nodeId);
    if (!node || node.status !== 'active' || !node.publicKey)
        fail('unknown node');
    const body = request.method === 'POST' ? await readRaw(request) : Buffer.alloc(0);
    const digest = digestOf(body);
    if (digest !== h[HEADERS.digest])
        fail('digest');
    const actor = String(h[HEADERS.actor] || '');
    if (actor.length > 128 || /[\s/\\]/.test(actor))
        fail('actor');
    const rolesRaw = String(h[HEADERS.roles] || '');
    const roles = rolesRaw ? rolesRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
    if (roles.some(r => !/^[A-Z][A-Z0-9_]*$/.test(r)))
        fail('roles');
    const signed = canonical({
        method: request.method, url: request.url, audience: serverId, date, nonce,
        node: nodeId, actor, roles: rolesRaw, digest,
    });
    if (!verify(signed, h[HEADERS.signature], node.publicKey))
        fail('signature');
    if (!rememberNonce(nodeId, nonce))
        fail('replay');
    request.rawBody = body;
    let actorLabel = '';
    try { actorLabel = decodeURIComponent(String(h[HEADERS.actorLabel] || '')); } catch { /* без подписи представителя */ }
    const principal = Object.freeze({
        kind: 'node',
        id: nodeId,
        actor: actor ? actor + '@' + nodeId : undefined,
        actorLabel: actorLabel || undefined,
        roles: Object.freeze(roles),
    });
    const session = {
        ephemeral: true,
        ssid: 'node:' + nodeId,
        sockets: {},
        uid: nodeId,
        $user: node.item,
        principal,
        ip: request.socket?.remoteAddress,
        send() {},
    };
    audit('node', { node: nodeId, actor: principal.actor, roles, url: request.url, params: { session } });
    return session;
}
