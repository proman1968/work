/**
 * Обнаружение по объявлениям устройств (сами отвечают на групповой запрос):
 *   mDNS / DNS-SD (принтеры, сканеры, шары, веб-панели), SSDP (UPnP), WS-Discovery (устройства Windows/принтеры),
 *   SQL Server Browser (экземпляры MSSQL). Только node:dgram, без зависимостей.
 */
import dgram from 'node:dgram';
import crypto from 'node:crypto';

export const MDNS_TYPES = {
    '_ipp._tcp.local': 'printer', '_ipps._tcp.local': 'printer', '_printer._tcp.local': 'printer', '_pdl-datastream._tcp.local': 'printer',
    '_uscan._tcp.local': 'scanner', '_uscans._tcp.local': 'scanner', '_scanner._tcp.local': 'scanner',
    '_smb._tcp.local': 'share', '_afpovertcp._tcp.local': 'share', '_nfs._tcp.local': 'share',
    '_http._tcp.local': 'http', '_https._tcp.local': 'http',
};

// ── DNS (минимум для mDNS) ────────────────────────────────────────────────

function encodeName(name) {
    const parts = name.replace(/\.$/, '').split('.');
    return Buffer.concat([...parts.map(p => Buffer.concat([Buffer.from([Buffer.byteLength(p)]), Buffer.from(p)])), Buffer.from([0])]);
}

/** Запрос PTR по списку имён. */
export function mdnsQuery(names) {
    const head = Buffer.alloc(12);
    head.writeUInt16BE(names.length, 4);
    const qs = names.map(n => Buffer.concat([encodeName(n), Buffer.from([0, 12, 0, 1])]));
    return Buffer.concat([head, ...qs]);
}

function readName(buf, off, depth = 0) {
    const labels = [];
    let pos = off, jumped = false, end = off;
    while (pos < buf.length && depth < 20) {
        const len = buf[pos];
        if (len === 0) {
            if (!jumped)
                end = pos + 1;
            break;
        }
        if ((len & 0xc0) === 0xc0) {
            if (!jumped)
                end = pos + 2;
            pos = ((len & 0x3f) << 8) | buf[pos + 1];
            jumped = true;
            depth++;
            continue;
        }
        labels.push(buf.toString('utf-8', pos + 1, pos + 1 + len));
        pos += len + 1;
    }
    return { name: labels.join('.'), end };
}

/** Ответ mDNS → записи [{ name, type, data }] (PTR/SRV/TXT/A). */
export function parseDns(buf) {
    const out = [];
    const qd = buf.readUInt16BE(4);
    const total = buf.readUInt16BE(6) + buf.readUInt16BE(8) + buf.readUInt16BE(10);
    let off = 12;
    for (let i = 0; i < qd; i++)
        off = readName(buf, off).end + 4;
    for (let i = 0; i < total && off < buf.length; i++) {
        const { name, end } = readName(buf, off);
        const type = buf.readUInt16BE(end);
        const len = buf.readUInt16BE(end + 8);
        const at = end + 10;
        let data = null;
        if (type === 12)
            data = readName(buf, at).name;
        else if (type === 33)
            data = { port: buf.readUInt16BE(at + 4), target: readName(buf, at + 6).name };
        else if (type === 1 && len === 4)
            data = [...buf.subarray(at, at + 4)].join('.');
        else if (type === 16) {
            data = {};
            for (let p = at; p < at + len;) {
                const l = buf[p];
                const s = buf.toString('utf-8', p + 1, p + 1 + l);
                const eq = s.indexOf('=');
                if (s)
                    data[eq < 0 ? s : s.slice(0, eq)] = eq < 0 ? true : s.slice(eq + 1);
                p += l + 1;
            }
        }
        out.push({ name, type, data });
        off = at + len;
    }
    return out;
}

/** Записи mDNS → устройства [{ host, port, kind, label, info, via }]. */
export function mdnsDevices(records, from) {
    const srv = new Map(), txt = new Map(), addr = new Map(), ptr = [];
    for (const r of records) {
        if (r.type === 12 && MDNS_TYPES[r.name.toLowerCase()])
            ptr.push({ type: r.name.toLowerCase(), instance: r.data });
        else if (r.type === 33)
            srv.set(r.name, r.data);
        else if (r.type === 16)
            txt.set(r.name, r.data);
        else if (r.type === 1)
            addr.set(r.name, r.data);
    }
    return ptr.map(p => {
        const s = srv.get(p.instance);
        const t = txt.get(p.instance) || {};
        return {
            host: (s && addr.get(s.target)) || from,
            port: s?.port,
            kind: MDNS_TYPES[p.type],
            label: p.instance.split('.' + p.type)[0] || p.instance,
            info: { mdns: p.type, target: s?.target, model: t.ty || t.product || t.mdl, rp: t.rp, rs: t.rs, adminurl: t.adminurl },
            via: 'mdns',
        };
    });
}

// ── UDP-обход ─────────────────────────────────────────────────────────────

function udpRound({ send, port, address, timeout, onMessage, broadcast, multicast }) {
    return new Promise(resolve => {
        const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
        const finish = () => {
            try {
                sock.close();
            }
            catch { /* закрыт */ }
            resolve();
        };
        sock.on('error', finish);
        sock.on('message', (msg, rinfo) => {
            try {
                onMessage(msg, rinfo);
            }
            catch { /* чужой пакет */ }
        });
        sock.bind(0, () => {
            try {
                if (broadcast)
                    sock.setBroadcast(true);
                if (multicast)
                    sock.setMulticastTTL(2);
                for (const a of [].concat(address))
                    sock.send(send, port, a);
            }
            catch { /* нет маршрута */ }
            setTimeout(finish, timeout);
        });
    });
}

export async function mdns(timeout = 3000) {
    const out = [];
    await udpRound({
        send: mdnsQuery(Object.keys(MDNS_TYPES)), port: 5353, address: '224.0.0.251', timeout, multicast: true,
        onMessage: (msg, r) => out.push(...mdnsDevices(parseDns(msg), r.address)),
    });
    return out;
}

/** Заголовки SSDP-ответа → устройство. */
export function parseSsdp(text, from) {
    const h = {};
    for (const line of String(text).split(/\r?\n/).slice(1)) {
        const i = line.indexOf(':');
        if (i > 0)
            h[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
    }
    const st = (h.st || h.nt || '').toLowerCase();
    const kind = /printer/.test(st) ? 'printer' : /scanner/.test(st) ? 'scanner' : /mediaserver|nas|storage/.test(st) ? 'share' : 'http';
    let port;
    try {
        port = Number(new URL(h.location).port) || 80;
    }
    catch { /* без location */ }
    return { host: from, port, kind, label: h.server || st, info: { ssdp: st, location: h.location, server: h.server, usn: h.usn }, via: 'ssdp' };
}

export async function ssdp(timeout = 3000) {
    const msg = Buffer.from('M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ssdp:all\r\n\r\n');
    const out = new Map();
    await udpRound({
        send: msg, port: 1900, address: '239.255.255.250', timeout, multicast: true,
        onMessage: (m, r) => {
            const d = parseSsdp(m.toString('utf-8'), r.address);
            const k = d.host + ':' + d.port;
            if (!out.has(k) || d.kind !== 'http')
                out.set(k, d);
        },
    });
    return [...out.values()];
}

/** SSDP location (описание UPnP) → friendlyName, manufacturer, modelName. */
export async function upnpDescribe(location, signal) {
    try {
        const res = await fetch(location, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(3000)]) : AbortSignal.timeout(3000) });
        const xml = await res.text();
        const tag = t => xml.match(new RegExp('<' + t + '>([^<]*)</' + t + '>', 'i'))?.[1]?.trim();
        return { name: tag('friendlyName'), manufacturer: tag('manufacturer'), model: tag('modelName'), deviceType: tag('deviceType'), presentation: tag('presentationURL') };
    }
    catch {
        return null;
    }
}

export function wsdProbe() {
    const id = 'urn:uuid:' + crypto.randomUUID();
    return Buffer.from('<?xml version="1.0" encoding="utf-8"?>'
        + '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:wsd="http://schemas.xmlsoap.org/ws/2005/04/discovery">'
        + '<soap:Header><wsa:To>urn:schemas-xmlsoap-org:ws:2005:04:discovery</wsa:To><wsa:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</wsa:Action><wsa:MessageID>' + id + '</wsa:MessageID></soap:Header>'
        + '<soap:Body><wsd:Probe/></soap:Body></soap:Envelope>');
}

export function parseWsd(xml, from) {
    const types = (String(xml).match(/<[\w:]*Types>([^<]*)<\/[\w:]*Types>/i)?.[1] || '').trim();
    const xaddrs = (String(xml).match(/<[\w:]*XAddrs>([^<]*)<\/[\w:]*XAddrs>/i)?.[1] || '').trim().split(/\s+/).filter(Boolean);
    const kind = /print/i.test(types) ? 'printer' : /scan/i.test(types) ? 'scanner' : /computer/i.test(types) ? 'share' : 'http';
    let port;
    try {
        port = xaddrs[0] ? Number(new URL(xaddrs[0]).port) || 80 : undefined;
    }
    catch { /* нет адреса */ }
    return { host: from, port: kind === 'share' ? 445 : port, kind, label: types, info: { wsd: types, xaddrs }, via: 'wsd' };
}

export async function wsd(timeout = 3000) {
    const out = new Map();
    await udpRound({
        send: wsdProbe(), port: 3702, address: '239.255.255.250', timeout, multicast: true,
        onMessage: (m, r) => {
            const d = parseWsd(m.toString('utf-8'), r.address);
            out.set(d.host + ':' + d.port, d);
        },
    });
    return [...out.values()];
}

/** Ответ SQL Server Browser (0x05 + длина + "ServerName;X;InstanceName;Y;…;tcp;1433;;…") → экземпляры. */
export function parseSqlBrowser(buf, from) {
    if (buf[0] !== 0x05)
        return [];
    const text = buf.toString('latin1', 3);
    return text.split(';;').filter(Boolean).map(chunk => {
        const p = chunk.split(';');
        const kv = {};
        for (let i = 0; i + 1 < p.length; i += 2)
            kv[p[i]] = p[i + 1];
        return {
            host: from, port: kv.tcp ? Number(kv.tcp) : undefined, kind: 'sql',
            label: (kv.ServerName || from) + (kv.InstanceName && kv.InstanceName !== 'MSSQLSERVER' ? '\\' + kv.InstanceName : ''),
            info: { dialect: 'mssql', server: kv.ServerName, instance: kv.InstanceName, version: kv.Version },
            via: 'sqlbrowser',
        };
    }).filter(d => d.port);
}

export async function sqlBrowser(broadcasts, timeout = 2000) {
    const out = [];
    if (!broadcasts.length)
        return out;
    await udpRound({
        send: Buffer.from([0x02]), port: 1434, address: broadcasts, timeout, broadcast: true,
        onMessage: (m, r) => out.push(...parseSqlBrowser(m, r.address)),
    });
    return out;
}

/** Все способы параллельно. methods — подмножество ['mdns','ssdp','wsd','sql']. */
export async function discoverAll({ timeout = 3000, methods, broadcasts = [] } = {}) {
    const want = new Set(methods?.length ? methods : ['mdns', 'ssdp', 'wsd', 'sql']);
    const jobs = [
        want.has('mdns') && mdns(timeout),
        want.has('ssdp') && ssdp(timeout),
        want.has('wsd') && wsd(timeout),
        want.has('sql') && sqlBrowser(broadcasts, Math.min(timeout, 2500)),
    ].filter(Boolean);
    return (await Promise.all(jobs.map(j => j.catch(() => [])))).flat();
}
