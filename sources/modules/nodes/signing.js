/**
 * Подпись межсерверных запросов WORK (по мотивам HTTP Message Signatures, RFC 9421).
 * Подписывается каноническая строка: протокол, метод, путь с запросом, адресат (id сервера),
 * время, nonce, узел-отправитель, представитель (actor), его метка (actorLabel, F18 —
 * раньше не подписывалась и подменялась на пути), заявленные роли, SHA-256 тела.
 */
import crypto from 'node:crypto';
import { PROTOCOL } from './identity.js';
import { indexDb, registerSchema } from '../../host/index-db.js';

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

/** actorLabel — значение заголовка как есть (процент-кодирование одинаково на обеих сторонах). */
export function canonical({ method, url, audience, date, nonce, node, actor, actorLabel, roles, digest }) {
    return [PROTOCOL, String(method).toUpperCase(), url, audience, date, nonce, node, actor || '', actorLabel || '', roles || '', digest].join('\n');
}

// Одноразовость запросов (F18): nonce помнятся в общей БД индексов (.index/work.db) —
// переживает рестарт сервера; без БД — деградация в память (окно повтора после рестарта).
registerSchema(`
CREATE TABLE IF NOT EXISTS node_nonces(
    node TEXT NOT NULL,
    nonce TEXT NOT NULL,
    at INTEGER,
    PRIMARY KEY (node, nonce)
);
`);

const seenFallback = new Map();
let nonceCalls = 0;

/**
 * Отметить nonce узла. true — впервые (запрос принимается), false — повтор.
 * @returns {Promise<boolean>}
 */
export async function rememberNonce(node, nonce) {
    const key = String(node) + ':' + String(nonce);
    const now = Date.now();
    const db = await indexDb().catch(() => null);
    if (!db) {
        // деградация: память (БД индексов недоступна)
        if (seenFallback.size > 50_000)
            for (const [k, t] of seenFallback)
                if (now - t > 2 * MAX_SKEW_MS)
                    seenFallback.delete(k);
        if (seenFallback.has(key))
            return false;
        seenFallback.set(key, now);
        return true;
    }
    if (++nonceCalls % 256 === 0)
        db.prepare('DELETE FROM node_nonces WHERE at < ?').run(now - 2 * MAX_SKEW_MS);
    const r = db.prepare('INSERT OR IGNORE INTO node_nonces(node, nonce, at) VALUES (?, ?, ?)').run(String(node), String(nonce), now);
    return Number(r.changes) > 0;
}
