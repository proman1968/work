/**
 * Исходящий подписанный запрос к узлу сети WORK от имени нашего сервера
 * (и, если задан, нашего представителя — actor, с заявленными ролями).
 */
import crypto from 'node:crypto';
import { serverId } from '../../host/server-id.js';
import { sign } from './identity.js';
import { HEADERS, canonical, digestOf } from './signing.js';

const RESPONSE_MAX = 32 * 1024 * 1024;

/**
 * @param {object} node Данные узла: {host_id, origin}
 * @param {object} req {path, method, params, post, actor, actorLabel, roles, timeoutMs}
 * @returns {Promise<*>} JSON или текст ответа
 */
export async function nodeFetch(node, req = {}) {
    if (!node?.origin || !node?.host_id)
        throw new Error('nodeFetch: у узла нет адреса или id');
    const url = new URL(String(req.path || '/').replace(/^\/*/, '/'), node.origin);
    if (req.method)
        url.search = '?' + encodeURIComponent(req.method);
    for (const [k, v] of Object.entries(req.params || {}))
        if (v != null && k !== 'session' && k !== 'role')
            url.searchParams.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    // роль на удалённом узле = заявленная роль представителя (для записи в её зону)
    if (req.roles?.length === 1)
        url.searchParams.append('role', req.roles[0]);
    let body = null;
    let contentType;
    if (req.post !== undefined && req.post !== null) {
        if (Buffer.isBuffer(req.post))
            body = req.post, contentType = 'application/octet-stream';
        else if (typeof req.post === 'string')
            body = Buffer.from(req.post), contentType = 'text/plain; charset=utf-8';
        else
            body = Buffer.from(JSON.stringify(req.post)), contentType = 'application/json';
    }
    const date = new Date().toISOString();
    const nonce = crypto.randomBytes(16).toString('base64url');
    const roles = (req.roles || []).join(',');
    const pathQuery = url.pathname + url.search;
    const digest = digestOf(body);
    const fields = {
        method: body ? 'POST' : 'GET', url: pathQuery, audience: String(node.host_id).toUpperCase(),
        date, nonce, node: serverId, actor: req.actor || '', roles, digest,
    };
    const headers = {
        [HEADERS.node]: serverId,
        [HEADERS.audience]: fields.audience,
        [HEADERS.date]: date,
        [HEADERS.nonce]: nonce,
        [HEADERS.digest]: digest,
        [HEADERS.signature]: sign(canonical(fields)),
        accept: 'application/json',
    };
    if (req.actor)
        headers[HEADERS.actor] = req.actor;
    if (req.actorLabel)
        headers[HEADERS.actorLabel] = encodeURIComponent(String(req.actorLabel).slice(0, 200));
    if (roles)
        headers[HEADERS.roles] = roles;
    if (contentType)
        headers['content-type'] = contentType;
    const res = await fetch(url, {
        method: fields.method, headers, body,
        redirect: 'error',
        signal: AbortSignal.timeout(req.timeoutMs || 30_000),
    });
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > RESPONSE_MAX)
        throw new Error('Ответ узла слишком большой');
    const text = buf.toString('utf-8');
    if (!res.ok)
        throw new Error('Узел ' + node.host_id + ': HTTP ' + res.status + ' ' + text.slice(0, 300));
    const type = res.headers.get('content-type') || '';
    if (type.includes('json')) {
        try {
            return JSON.parse(text);
        }
        catch { /* не JSON — текстом */ }
    }
    return text;
}
