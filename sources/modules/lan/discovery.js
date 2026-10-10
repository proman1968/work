/** Multicast discovery: DNS-SD/mDNS, SSDP, WS-Discovery. Запросы поиска, не скан портов. */
import dgram from 'node:dgram';
import { randomUUID } from 'node:crypto';
import { localNets, inCidr } from './subnet.js';
import { allowedNets, lanRequest, pool } from './net.js';

const TYPES = ['_ipp._tcp.local', '_ipps._tcp.local', '_uscan._tcp.local', '_uscans._tcp.local', '_scanner._tcp.local', '_http._tcp.local', '_smb._tcp.local'];

function dnsName(name) {
    return Buffer.concat([...name.split('.').map(s => Buffer.concat([Buffer.from([Buffer.byteLength(s)]), Buffer.from(s)])), Buffer.from([0])]);
}

export function mdnsQuery() {
    const h = Buffer.alloc(12); h.writeUInt16BE(TYPES.length, 4);
    // QU bit: ответ на порт отправителя (не нужен привилегированный bind на 5353).
    return Buffer.concat([h, ...TYPES.map(t => Buffer.concat([dnsName(t), Buffer.from([0, 12, 128, 1])]))]);
}

export function parseDns(buf) {
    if (buf.length < 12) throw new Error('Короткий DNS пакет');
    function name(at, visited = new Set()) {
        const labels = [];
        let end;
        for (let i = 0; i < 128; i++) {
            if (at >= buf.length || visited.has(at)) throw new Error('Некорректное DNS имя');
            visited.add(at);
            const length = buf[at++];
            if (!length) return { value: labels.join('.'), end: end ?? at };
            if ((length & 0xc0) === 0xc0) {
                if (at >= buf.length) throw new Error('Обрезанный DNS pointer');
                const target = ((length & 0x3f) << 8) | buf[at++];
                end ??= at;
                at = target;
                continue;
            }
            if (length > 63 || at + length > buf.length) throw new Error('Обрезанная DNS метка');
            labels.push(buf.toString('utf8', at, at + length)); at += length;
        }
        throw new Error('Слишком длинное DNS имя');
    }
    let at = 12;
    const count = buf.readUInt16BE(6) + buf.readUInt16BE(8) + buf.readUInt16BE(10);
    if (count > 1024 || buf.readUInt16BE(4) > 1024) throw new Error('Слишком много DNS записей');
    for (let i = 0; i < buf.readUInt16BE(4); i++) at = name(at).end + 4;
    const rows = [];
    for (let i = 0; i < count; i++) {
        const n = name(at); at = n.end;
        if (at + 10 > buf.length) throw new Error('Обрезанный DNS RR');
        const type = buf.readUInt16BE(at), ttl = buf.readUInt32BE(at + 4), len = buf.readUInt16BE(at + 8);
        at += 10;
        const end = at + len;
        if (end > buf.length) throw new Error('Обрезанный DNS RDATA');
        let value;
        if (type === 1 && len === 4) value = [...buf.subarray(at, end)].join('.');
        if (type === 12) value = name(at).value;
        if (type === 33 && len >= 7) value = { port: buf.readUInt16BE(at + 4), target: name(at + 6).value };
        if (type === 16) {
            value = Object.create(null);
            for (let p = at; p < end;) {
                const size = buf[p++];
                if (p + size > end) throw new Error('Обрезанный TXT');
                const s = buf.toString('utf8', p, p + size); p += size;
                const eq = s.indexOf('=');
                value[eq < 0 ? s : s.slice(0, eq)] = eq < 0 ? '' : s.slice(eq + 1);
            }
        }
        if (value !== undefined && ttl) rows.push({ name: n.value, type, value });
        at = end;
    }
    return rows;
}

export function dnsCandidates(records, permitted) {
    const out = [];
    for (const r of records.filter(r => r.type === 33)) {
        const service = TYPES.find(t => r.name.endsWith('.' + t));
        if (!service) continue;
        const address = records.find(a => a.type === 1 && a.name === r.value.target)?.value;
        if (!address || !permitted(address)) continue;
        const txt = records.find(a => a.type === 16 && a.name === r.name)?.value || {};
        const scanner = /_uscan|_scanner/.test(service), printer = /_ipps?\./.test(service);
        const secure = /_ipps\.|_uscans\./.test(service);
        const pathname = scanner ? 'eSCL/' : printer ? (txt.rp || 'ipp/print') : '';
        out.push({ host: address, port: r.value.port, kind: scanner ? 'scanner' : printer ? 'printer' : service.startsWith('_smb') ? 'share' : 'web',
            label: txt.ty || r.name.slice(0, -(service.length + 1)), confidence: 'advertised', via: 'mdns',
            url: `${secure ? 'https' : 'http'}://${address}:${r.value.port}/${pathname.replace(/^\/+/, '')}`,
            info: { service, hostname: r.value.target, txt } });
    }
    return out;
}

export function parseAnnouncement(text, host, via) {
    let urls = [];
    if (via === 'ssdp') urls = [text.match(/^location:\s*(.+)$/im)?.[1]?.trim()].filter(Boolean);
    else urls = (text.match(/<(?:\w+:)?XAddrs\b[^>]*>([^<]+)<\//i)?.[1] || '').trim().split(/\s+/).filter(Boolean);
    return urls.flatMap(raw => {
        try {
            const u = new URL(raw);
            if (!['http:', 'https:'].includes(u.protocol)) return [];
            return [{ host, port: Number(u.port) || (u.protocol === 'https:' ? 443 : 80), url: u.href,
                kind: /scan/i.test(text) ? 'scanner' : /print/i.test(text) ? 'printer' : 'web',
                label: host, confidence: 'advertised', via, info: { announcement: text.slice(0, 3000) } }];
        }
        catch { return []; }
    });
}

export async function discover(cfg, { signal, duration = 2500 } = {}) {
    signal?.throwIfAborted();
    duration = Math.min(10000, Math.max(500, Number(duration) || 2500));
    const nets = allowedNets(cfg);
    const permitted = ip => nets.some(c => inCidr(ip, c));
    const candidates = [], records = [], errors = [];
    const interfaces = localNets().filter(n => permitted(n.address));
    const ws = `<?xml version="1.0"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:a="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery"><s:Header><a:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</a:Action><a:MessageID>urn:uuid:${randomUUID()}</a:MessageID><a:To>urn:schemas-xmlsoap-org:ws:2005:04:discovery</a:To></s:Header><s:Body><d:Probe/></s:Body></s:Envelope>`;
    const protocols = [
        ['mdns', '224.0.0.251', 5353, mdnsQuery()],
        ['ssdp', '239.255.255.250', 1900, Buffer.from('M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ssdp:all\r\n\r\n')],
        ['ws-discovery', '239.255.255.250', 3702, Buffer.from(ws)],
    ];
    await Promise.all(interfaces.flatMap(n => protocols.map(([via, target, port, data]) => new Promise(resolve => {
        const sock = dgram.createSocket('udp4');
        let closed = false, packets = 0;
        const close = () => {
            if (closed) return;
            closed = true; clearTimeout(timer);
            signal?.removeEventListener('abort', close);
            try { sock.close(); } catch { /* не успел открыться */ }
            resolve();
        };
        const timer = setTimeout(close, duration);
        signal?.addEventListener('abort', close, { once: true });
        sock.on('error', e => { errors.push({ interface: n.name, protocol: via, error: e.message }); close(); });
        sock.on('message', (buf, peer) => {
            if (++packets > 200 || buf.length > 32768 || !permitted(peer.address)) return;
            try {
                if (via === 'mdns') records.push(...parseDns(buf));
                else candidates.push(...parseAnnouncement(buf.toString('utf8'), peer.address, via));
            }
            catch { /* некорректное объявление */ }
        });
        sock.bind(0, n.address, () => {
            if (closed) return;
            try {
                sock.setMulticastInterface(n.address); sock.setMulticastTTL(1);
                sock.send(data, port, target, e => { if (e) { errors.push({ protocol: via, error: e.message }); close(); } });
            }
            catch (e) { errors.push({ interface: n.name, protocol: via, error: e.message }); close(); }
        });
    }))));
    signal?.throwIfAborted();
    candidates.push(...dnsCandidates(records, permitted));
    // SSDP указывает на XML-описание, не на управляющий endpoint. Читаем его ограниченно.
    await pool(candidates.filter(c => c.via === 'ssdp').slice(0, 30), 4, async c => {
        try {
            const res = await lanRequest(c.url, cfg, { signal, timeout: 2000, maxBytes: 128 * 1024 });
            if (res.status !== 200) return;
            const text = res.body.toString('utf8');
            const field = name => text.match(new RegExp('<' + name + '\\b[^>]*>([^<]*)</' + name + '>', 'i'))?.[1]?.trim().slice(0, 200);
            c.info.manufacturer = field('manufacturer'); c.info.model = field('modelName');
            c.label = field('friendlyName') || c.info.model || c.label;
        }
        catch { /* оставляем само объявление */ }
    }, signal);
    return { interfaces: interfaces.map(n => n.name), candidates, errors };
}
