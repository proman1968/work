/**
 * Подпись межсерверных запросов WORK (по мотивам HTTP Message Signatures, RFC 9421).
 * Подписывается каноническая строка: протокол, метод, путь с запросом, адресат (id сервера),
 * время, nonce, узел-отправитель, представитель (actor), заявленные роли, SHA-256 тела.
 */
import crypto from 'node:crypto';
import { PROTOCOL } from './identity.js';

export const HEADERS = Object.freeze({
    node: 'work-node',
    audience: 'work-audience',
    actor: 'work-actor',
    actorLabel: 'work-actor-label',
    roles: 'work-roles',
    date: 'work-date',
    nonce: 'work-nonce',
    digest: 'work-digest',
    signature: 'work-signature',
});

export const MAX_SKEW_MS = 5 * 60_000;

export function digestOf(body) {
    return crypto.createHash('sha256').update(body || Buffer.alloc(0)).digest('base64');
}

export function canonical({ method, url, audience, date, nonce, node, actor, roles, digest }) {
    return [PROTOCOL, String(method).toUpperCase(), url, audience, date, nonce, node, actor || '', roles || '', digest].join('\n');
}

/** Одноразовость запросов: nonce помнится дольше допустимого расхождения времени. */
const seen = new Map();
export function rememberNonce(node, nonce) {
    const now = Date.now();
    if (seen.size > 50_000)
        for (const [k, t] of seen)
            if (now - t > 2 * MAX_SKEW_MS)
                seen.delete(k);
    const key = node + ':' + nonce;
    if (seen.has(key))
        return false;
    seen.set(key, now);
    return true;
}
