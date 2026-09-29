/**
 * Исходящие HTTP-запросы по адресам из пользовательского ввода (proxy, загрузка по URL):
 * только http/https, адрес назначения — публичный (не loopback, не частные сети,
 * не link-local/метаданные облака), IP закрепляется на время соединения (защита от DNS rebinding),
 * лимиты размера ответа, времени и числа редиректов.
 */
import * as http from 'node:http';
import * as https from 'node:https';
import * as dns from 'node:dns';
import * as net from 'node:net';

const DEFAULTS = { maxBytes: 20 * 1024 * 1024, timeoutMs: 20_000, maxRedirects: 3 };

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
        return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v) || v.startsWith('::ffff:') || v.startsWith('64:ff9b:') || v.startsWith('2001:db8') || v.startsWith('2002:');
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

/** Проверить URL и разрешить имя в публичный адрес. */
export async function resolvePublicUrl(raw) {
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
        : await dns.promises.lookup(host, { all: true });
    if (!addrs.length || addrs.some(a => isPrivateAddress(a.address)))
        throw new Error('Адрес назначения недоступен: внутренняя сеть');
    return { url, address: addrs[0].address, family: addrs[0].family };
}

/**
 * GET по пользовательскому URL.
 * @returns {Promise<{status: number, headers: object, body: Buffer, url: string}>}
 */
export async function guardedGet(raw, opts = {}) {
    const { maxBytes, timeoutMs, maxRedirects } = { ...DEFAULTS, ...opts };
    let target = raw;
    for (let hop = 0; hop <= maxRedirects; hop++) {
        opts.signal?.throwIfAborted();
        const { url, address, family } = await resolvePublicUrl(target);
        opts.signal?.throwIfAborted();
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
                method: 'GET',
                timeout: timeoutMs,
                headers: { 'user-agent': 'WORK/1.0', ...(opts.headers || {}) },
                // закреплённый адрес: повторное разрешение имени в частный IP невозможно
                lookup: (_h, o, cb) => o?.all ? cb(null, [{ address, family }]) : cb(null, address, family),
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
                response.on('end', () => finish(null, { status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks), url: url.href }));
                response.on('error', e => finish(e));
            });
            const abort = () => { finish(new Error('Запрос остановлен')); req.destroy(); };
            const timedOut = () => { finish(new Error('Превышено время ожидания')); req.destroy(); };
            opts.signal?.addEventListener('abort', abort, { once: true });
            timer = setTimeout(timedOut, timeoutMs);
            req.on('timeout', timedOut);
            req.on('error', e => finish(e));
            req.end();
        });
        if (res.status >= 300 && res.status < 400 && res.headers.location) {
            target = new URL(res.headers.location, url).href;
            continue;
        }
        return res;
    }
    throw new Error('Слишком много перенаправлений');
}
