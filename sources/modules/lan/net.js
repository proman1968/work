/**
 * Сетевые примитивы для устройств локальной сети: TCP-соединение, HTTP(S)-запрос с лимитами,
 * проверка адреса по разрешённым подсетям (#system/os.json subnets или свои подсети сервера).
 */
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import { localNets, inCidr } from './subnet.js';

/** Разрешённые для работы подсети. */
export function allowedNets(cfg) {
    const list = (cfg?.subnets || []).length ? cfg.subnets : localNets().map(n => n.cidr);
    return list.map(String);
}

export async function resolveHost(host, cfg) {
    if (typeof host !== 'string' || !host || /[\s/@\\]/.test(host))
        throw new Error('Некорректный адрес устройства');
    const rows = await dns.promises.lookup(host, { all: true });
    const nets = allowedNets(cfg);
    if (!rows.length || rows.some(r => r.family !== 4 || !nets.some(c => inCidr(r.address, c))))
        throw new Error('Адрес вне разрешённых подсетей: ' + host);
    return rows[0].address;
}

export function portNumber(value) {
    const port = Number(value);
    if (!Number.isInteger(port) || port < 1 || port > 65535)
        throw new Error('Некорректный порт');
    return port;
}

/** Один TCP connect; никаких данных принтеру/неизвестному сервису не отправляем. */
export function tcpOpen(address, port, { timeout = 700, signal } = {}) {
    signal?.throwIfAborted();
    return new Promise(resolve => {
        const socket = new net.Socket();
        let done = false;
        const finish = open => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
            socket.destroy();
            resolve(open);
        };
        const abort = () => finish(false);
        const timer = setTimeout(abort, timeout);
        signal?.addEventListener('abort', abort, { once: true });
        socket.once('error', abort);
        socket.connect(portNumber(port), address, () => finish(true));
    });
}

/** Ограниченная параллельность; результат соответствует порядку входного массива. */
export async function pool(list, count, fn, signal) {
    const result = new Array(list.length);
    let index = 0;
    await Promise.all(Array.from({ length: Math.min(count, list.length) }, async () => {
        while (index < list.length) {
            signal?.throwIfAborted();
            const i = index++;
            result[i] = await fn(list[i], i);
        }
    }));
    return result;
}

/** HTTP к LAN: IP закреплён после проверки, редиректы обрабатывает вызывающий код. */
export async function lanRequest(raw, cfg, opts = {}) {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
        throw new Error('Устройство: нужен http(s) URL без учётных данных');
    const signal = opts.signal;
    signal?.throwIfAborted();
    const address = await resolveHost(url.hostname, cfg);
    signal?.throwIfAborted();
    const max = opts.maxBytes ?? 2 * 1024 * 1024;
    return new Promise((resolve, reject) => {
        let done = false;
        let timer;
        const finish = (error, result) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
            error ? reject(error) : resolve(result);
        };
        const req = (url.protocol === 'https:' ? https : http).request(url, {
            method: opts.method || 'GET',
            headers: opts.headers || {},
            lookup: (_host, o, cb) => o?.all ? cb(null, [{ address, family: 4 }]) : cb(null, address, 4),
        }, res => {
            const chunks = [];
            let length = 0;
            res.on('data', chunk => {
                length += chunk.length;
                if (length > max) {
                    finish(new Error('Ответ устройства превышает лимит'));
                    res.destroy();
                    req.destroy();
                    return;
                }
                chunks.push(chunk);
            });
            res.on('error', e => finish(e));
            res.on('end', () => finish(null, { status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks), url: url.href }));
        });
        const abort = () => { finish(new Error('Запрос остановлен')); req.destroy(); };
        req.on('error', e => finish(e));
        signal?.addEventListener('abort', abort, { once: true });
        timer = setTimeout(() => { finish(new Error('Таймаут устройства')); req.destroy(); }, opts.timeout ?? 5000);
        req.end(opts.body);
    });
}
