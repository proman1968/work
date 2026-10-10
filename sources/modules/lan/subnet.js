/**
 * Подсети IPv4: разбор CIDR, перечисление адресов, частные сети интерфейсов сервера.
 */
import os from 'node:os';

export function ipToInt(ip) {
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(String(ip)))
        throw new Error('Некорректный IPv4: ' + ip);
    const p = String(ip).split('.').map(Number);
    if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255))
        throw new Error('некорректный IPv4: ' + ip);
    return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
}

export function intToIp(n) {
    return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

/** '192.168.1.0/24' → { base, bits, first, last, count } (без сети и broadcast при bits < 31). */
export function parseCidr(cidr) {
    if (!/^\d{1,3}(\.\d{1,3}){3}(\/\d{1,2})?$/.test(String(cidr).trim()))
        throw new Error('Некорректный CIDR: ' + cidr);
    const [ip, b] = String(cidr).trim().split('/');
    const bits = b == null ? 32 : Number(b);
    if (!Number.isInteger(bits) || bits < 0 || bits > 32)
        throw new Error('некорректная маска: ' + cidr);
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    const base = (ipToInt(ip) & mask) >>> 0;
    const broadcast = (base | (~mask >>> 0)) >>> 0;
    const first = bits >= 31 ? base : base + 1;
    const last = bits >= 31 ? broadcast : broadcast - 1;
    return { cidr: intToIp(base) + '/' + bits, base, bits, first, last, broadcast: intToIp(broadcast), count: last - first + 1 };
}

export function inCidr(ip, cidr) {
    const c = parseCidr(cidr);
    const n = ipToInt(ip);
    return n >= c.base && n <= ipToInt(c.broadcast);
}

export function* hosts(cidr) {
    const c = parseCidr(cidr);
    for (let n = c.first; n <= c.last; n++)
        yield intToIp(n);
}

export function isPrivate(ip) {
    return ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '169.254.0.0/16'].some(c => inCidr(ip, c));
}

/** Частные IPv4-сети интерфейсов сервера: [{ name, address, cidr, broadcast }]. */
export function localNets() {
    const out = [];
    for (const [name, list] of Object.entries(os.networkInterfaces())) {
        for (const a of list || []) {
            if (a.family !== 'IPv4' && a.family !== 4)
                continue;
            if (a.internal || !a.cidr || !isPrivate(a.address))
                continue;
            const c = parseCidr(a.cidr);
            out.push({ name, address: a.address, cidr: c.cidr, broadcast: c.broadcast });
        }
    }
    return out;
}

/**
 * Сеть разрешена для активной проверки: из #system/os.json subnets или (если пусто) частная сеть интерфейса.
 * @returns {string} нормализованный CIDR
 */
export function allowedCidr(cidr, cfg) {
    const c = parseCidr(cidr);
    const limit = Number(cfg?.maxScanHosts) || 1024;
    if (c.count > limit)
        throw new Error('слишком большая сеть (' + c.count + ' адресов, предел ' + limit + ' — #system/os.json maxScanHosts)');
    const allowed = (cfg?.subnets || []).length ? cfg.subnets : localNets().map(n => n.cidr);
    const ok = allowed.some(a => {
        const p = parseCidr(a);
        return c.base >= p.base && ipToInt(c.broadcast) <= ipToInt(p.broadcast);
    });
    if (!ok)
        throw new Error('сеть ' + c.cidr + ' не разрешена; доступны: ' + (allowed.join(', ') || 'нет частных сетей') + ' (#system/os.json subnets)');
    return c.cidr;
}
