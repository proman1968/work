/**
 * Исходящие HTTP-запросы по адресам из пользовательского ввода и от агента (proxy, загрузка по URL, web_fetch, http_request):
 * только http/https, адрес назначения — публичный (не loopback, не частные сети,
 * не link-local/метаданные облака), IP закрепляется на время соединения (защита от DNS rebinding),
 * лимиты размера ответа, времени и числа редиректов.
 *
 * Редиректы идут вручную: каждый переход заново проверяется и закрепляется. При смене origin
 * с запроса снимаются заголовки авторизации (authorization, cookie, proxy-authorization и
 * `sensitiveHeaders` — заголовки подключения), а изменяющий запрос (POST/PUT/PATCH/DELETE) после
 * 301/302/303 превращается в GET без тела; 307/308 с телом на другой origin отклоняются.
 */
import * as http from 'node:http';
import * as https from 'node:https';
import * as dns from 'node:dns';
import * as net from 'node:net';
import * as zlib from 'node:zlib';

const DEFAULTS = { maxBytes: 20 * 1024 * 1024, timeoutMs: 20_000, maxRedirects: 3 };

/** Заголовки, которые всегда снимаются при уходе на другой origin. */
const ALWAYS_SENSITIVE = ['authorization', 'cookie', 'proxy-authorization'];
/** Служебные заголовки соединения: выставляет сам транспорт, вызывающий их не задаёт. */
const HOP_HEADERS = new Set(['host', 'content-length', 'transfer-encoding', 'connection', 'upgrade', 'te', 'trailer', 'keep-alive', 'proxy-connection']);

/** Адрес недопустим для исходящих запросов по пользовательскому URL. */
export function isPrivateAddress(ip) {
    if (!net.isIP(ip))
        return true;
    if (net.isIPv6(ip)) {
        const v = new URL('http://[' + ip + ']/').hostname.slice(1, -1).toLowerCase();
        if (v === '::' || v === '::1')
            return true;
        const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
        if (mapped)
            return isPrivateAddress(mapped[1]);
        // ::/96 (IPv4-совместимые ::a.b.c.d), fc00::/7, fe80::/10 и fec0::/10 (site-local), ff00::/8, ::ffff:/96,
        // NAT64 64:ff9b::/96, Teredo 2001:0::/32, документационный 2001:db8::/32, 6to4 2002::/16
        return /^::([0-9a-f]{1,4}(:[0-9a-f]{1,4})?)?$/.test(v)
            || /^(fc|fd|fe[89abcdef]|ff)/.test(v) || v.startsWith('::ffff:') || v.startsWith('64:ff9b:')
            || /^2001:(0{1,4})?:/.test(v) || v.startsWith('2001:db8') || v.startsWith('2002:');
    }
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127
        || (a === 100 && b >= 64 && b <= 127)
        || (a === 169 && b === 254)
        || (a === 172 && b >= 16 && b <= 31)
        || (a === 192 && b === 168)
        || (a === 192 && b === 0)
        || (a === 198 && (b === 18 || b === 19))
        || a >= 224;
}

/**
 * Проверить URL и разрешить имя в публичный адрес.
 * opts.lookup (host → [{address, family}]) и opts.isPrivate — подмена для тестов; в коде приложения не задаются.
 */
export async function resolvePublicUrl(raw, opts = {}) {
    const lookup = opts.lookup || (h => dns.promises.lookup(h, { all: true }));
    const isPrivate = opts.isPrivate || isPrivateAddress;
    let url;
    try {
        url = new URL(String(raw));
    }
    catch {
        throw new Error('Недопустимый URL');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:')
        throw new Error('Разрешены только http и https');
    if (url.username || url.password)
        throw new Error('URL с учётными данными не допускается');
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const addrs = net.isIP(host) ? [{ address: host, family: net.isIPv6(host) ? 6 : 4 }]
        : await lookup(host);
    if (!addrs.length || addrs.some(a => isPrivate(a.address)))
        throw new Error('Адрес назначения недоступен: внутренняя сеть');
    return { url, address: addrs[0].address, family: addrs[0].family, addresses: addrs.map(a => ({ address: a.address, family: a.family })) };
}

function cleanHeaders(input) {
    const out = {};
    for (const [k, v] of Object.entries(input || {})) {
        const key = String(k).toLowerCase();
        if (!HOP_HEADERS.has(key) && v != null)
            out[key] = String(v);
    }
    return out;
}

/** Распаковка ответа с лимитом по размеру результата (защита от «бомб»). */
function decodeBody(buf, encoding, maxBytes) {
    const enc = String(encoding || '').toLowerCase().trim();
    const opt = { maxOutputLength: maxBytes };
    try {
        if (enc === 'gzip' || enc === 'x-gzip')
            return zlib.gunzipSync(buf, opt);
        if (enc === 'deflate')
            return zlib.inflateSync(buf, opt);
        if (enc === 'br')
            return zlib.brotliDecompressSync(buf, opt);
    }
    catch (e) {
        throw new Error(e.code === 'ERR_BUFFER_TOO_LARGE' ? 'Ответ больше допустимого размера' : 'Не удалось распаковать ответ: ' + e.message, { cause: e });
    }
    return buf;
}

/**
 * Запрос по пользовательскому URL с проверкой каждого перехода.
 * @param {string} raw
 * @param {object} [opts]
 * @param {string} [opts.method='GET']
 * @param {object} [opts.headers]
 * @param {string|Buffer} [opts.body]
 * @param {string[]} [opts.sensitiveHeaders] заголовки подключения: снимаются при уходе на другой origin
 * @param {number} [opts.maxBytes] @param {number} [opts.timeoutMs] (на один переход) @param {number} [opts.maxRedirects]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{status: number, headers: object, body: Buffer, url: string, redirects: number}>}
 */
export async function guardedRequest(raw, opts = {}) {
    const { maxBytes, timeoutMs, maxRedirects } = { ...DEFAULTS, ...opts };
    let method = String(opts.method || 'GET').toUpperCase();
    let body = opts.body == null ? null : Buffer.from(opts.body);
    const headers = { 'user-agent': 'WORK/1.0', 'accept-encoding': 'identity', ...cleanHeaders(opts.headers) };
    const sensitive = new Set([...ALWAYS_SENSITIVE, ...(opts.sensitiveHeaders || []).map(h => String(h).toLowerCase())]);
    let target = raw;
    for (let hop = 0; hop <= maxRedirects; hop++) {
        opts.signal?.throwIfAborted();
        const { url, address, family, addresses } = await resolvePublicUrl(target, opts);
        opts.signal?.throwIfAborted();
        const reqHeaders = { ...headers };
        if (body)
            reqHeaders['content-length'] = String(body.length);
        const res = await new Promise((resolve, reject) => {
            let timer;
            let done = false;
            const finish = (error, value) => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                opts.signal?.removeEventListener('abort', abort);
                error ? reject(error) : resolve(value);
            };
            const lib = url.protocol === 'https:' ? https : http;
            const req = lib.request(url, {
                method,
                timeout: timeoutMs,
                headers: reqHeaders,
                agent: false,
                // закреплённые адреса: повторное разрешение имени в частный IP невозможно; соединяться можно
                // только с уже проверенными публичными адресами (все — для автоподбора IPv4/IPv6 при недоступном семействе)
                lookup: (_h, o, cb) => o?.all ? cb(null, addresses) : cb(null, address, family),
            }, response => {
                const chunks = [];
                let size = 0;
                response.on('data', c => {
                    size += c.length;
                    if (size > maxBytes) {
                        finish(new Error('Ответ больше допустимого размера'));
                        response.destroy(); req.destroy();
                        return;
                    }
                    chunks.push(c);
                });
                response.on('end', () => {
                    try {
                        const packed = Buffer.concat(chunks);
                        const headersOut = { ...response.headers };
                        const decoded = method === 'HEAD' ? packed : decodeBody(packed, headersOut['content-encoding'], maxBytes);
                        if (decoded !== packed)
                            delete headersOut['content-encoding'];
                        finish(null, { status: response.statusCode, headers: headersOut, body: decoded, url: url.href });
                    }
                    catch (e) {
                        finish(e);
                    }
                });
                response.on('aborted', () => finish(new Error('Соединение разорвано до конца ответа')));
                response.on('error', e => finish(e));
            });
            const abort = () => { finish(new Error('Запрос остановлен')); req.destroy(); };
            const timedOut = () => { finish(new Error('Превышено время ожидания')); req.destroy(); };
            opts.signal?.addEventListener('abort', abort, { once: true });
            timer = setTimeout(timedOut, timeoutMs);
            req.on('timeout', timedOut);
            req.on('error', e => finish(e));
            if (body)
                req.write(body);
            req.end();
        });
        const location = res.headers.location;
        if (res.status >= 300 && res.status < 400 && location) {
            let next;
            try {
                next = new URL(location, url);
            }
            catch {
                throw new Error('Некорректный адрес перенаправления');
            }
            const crossOrigin = next.origin !== url.origin;
            if (res.status === 307 || res.status === 308) {
                if (body && crossOrigin)
                    throw new Error('Перенаправление на другой адрес (' + next.origin + ') для запроса с телом отклонено — повторите запрос по новому адресу явно');
            }
            else if (method !== 'GET' && method !== 'HEAD') {
                method = 'GET';
                body = null;
                delete headers['content-type'];
            }
            if (crossOrigin)
                for (const k of Object.keys(headers))
                    if (sensitive.has(k))
                        delete headers[k];
            target = next.href;
            continue;
        }
        return { ...res, redirects: hop };
    }
    throw new Error('Слишком много перенаправлений');
}

/**
 * GET по пользовательскому URL.
 * @returns {Promise<{status: number, headers: object, body: Buffer, url: string, redirects: number}>}
 */
export function guardedGet(raw, opts = {}) {
    return guardedRequest(raw, { ...opts, method: 'GET', body: undefined });
}
