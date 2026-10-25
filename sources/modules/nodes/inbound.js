/**
 * Входящий подписанный запрос узла сети WORK → эфемерная сессия субъекта-узла.
 * Узел должен быть в нашем реестре (/NODES) со статусом active и закреплённым ключом;
 * подпись, адресат, время, одноразовость и хеш тела проверяются.
 * Субъект: {kind: 'node', id: host_id, actor: 'uid@host_id', roles: [заявленные]} —
 * права узла в нашем дереве, ограниченные заявленными ролями (представитель действует
 * только в той роли, в которой его назначил свой сервер).
 *
 * F18 (final 8.11): content-length отсекается до чтения тела; тело больше SPOOL_BYTES
 * пишется потоком на диск (память не растёт от чужих неподписанных мегабайтов —
 * буфер в память собирается только после верной подписи); actorLabel входит в подпись.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { serverId } from '../../host/server-id.js';
import { verify } from './identity.js';
import { HEADERS, canonical, digestOf, MAX_SKEW_MS, rememberNonce } from './signing.js';
import { findNode } from './registry.js';
import { audit } from '../../server/access/audit.js';

export const BODY_MAX = 64 * 1024 * 1024;
/** Тела больше этого — на диск, не в память. */
export const SPOOL_BYTES = 8 * 1024 * 1024;
const ACCESS_DENIED = 'Доступ запрещён';

/**
 * Прочитать тело запроса потоком: хеш считается на лету; до SPOOL_BYTES — в память,
 * дальше — временный файл. Буфер собирается (load) только когда подпись уже сошлась.
 * @returns {Promise<{digest: string, spooled: boolean, load: () => Promise<Buffer>, discard: () => void}>}
 */
export async function readBody(request) {
    const hash = crypto.createHash('sha256');
    const chunks = [];
    let size = 0;
    let spool = null;
    let ws = null;
    const startSpool = () => {
        spool = path.join(os.tmpdir(), 'work-node-' + crypto.randomBytes(10).toString('hex') + '.body');
        ws = fs.createWriteStream(spool);
        for (const c of chunks)
            ws.write(c);
        chunks.length = 0;
    };
    const discard = () => {
        if (!spool)
            return;
        try { ws.destroy(); } catch { /* закрыт */ }
        fsp.rm(spool, { force: true }).catch(() => {});
    };
    try {
        for await (const c of request) {
            size += c.length;
            if (size > BODY_MAX) {
                discard();
                throw new Error('Тело запроса больше допустимого размера');
            }
            hash.update(c);
            if (spool)
                ws.write(c);
            else {
                chunks.push(c);
                if (size > SPOOL_BYTES)
                    startSpool();
            }
        }
    }
    catch (e) {
        discard();
        throw e;
    }
    const digest = hash.digest('base64');
    return {
        digest,
        spooled: !!spool,
        discard,
        async load() {
            if (!spool)
                return Buffer.concat(chunks);
            await new Promise(res => ws.end(res));
            try {
                return await fsp.readFile(spool);
            }
            finally {
                fsp.rm(spool, { force: true }).catch(() => {});
            }
        },
    };
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
    // заявленный размер отсекается до чтения: чужие гигабайты не читаем вовсе
    if (request.method === 'POST' && Number(h['content-length'] || 0) > BODY_MAX)
        fail('content-length');
    let body = null;
    if (request.method === 'POST') {
        body = await readBody(request);
        if (body.digest !== h[HEADERS.digest]) {
            body.discard();
            fail('digest');
        }
    }
    const actor = String(h[HEADERS.actor] || '');
    if (actor.length > 128 || /[\s/\\]/.test(actor))
        (body?.discard(), fail('actor'));
    const rolesRaw = String(h[HEADERS.roles] || '');
    const roles = rolesRaw ? rolesRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
    if (roles.some(r => !/^[A-Z][A-Z0-9_]*$/.test(r)))
        (body?.discard(), fail('roles'));
    // метка представителя подписана (F18): подмена/удаление на пути ломает подпись
    const actorLabelRaw = String(h[HEADERS.actorLabel] || '');
    if (actorLabelRaw.length > 300)
        (body?.discard(), fail('actor label'));
    const signed = canonical({
        method: request.method, url: request.url, audience: serverId, date, nonce,
        node: nodeId, actor, actorLabel: actorLabelRaw, roles: rolesRaw,
        digest: body ? body.digest : digestOf(null),
    });
    if (!verify(signed, h[HEADERS.signature], node.publicKey)) {
        body?.discard();
        fail('signature');
    }
    if (!(await rememberNonce(nodeId, nonce))) {
        body?.discard();
        fail('replay');
    }
    if (body)
        request.rawBody = await body.load();
    let actorLabel = '';
    try { actorLabel = decodeURIComponent(actorLabelRaw); } catch { /* повреждена — после проверки подписи */ }
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
