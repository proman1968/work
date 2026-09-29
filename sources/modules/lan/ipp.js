/** Минимальный IPP: чтение атрибутов и Print-Job; двоичные группы RFC 8010. */
import { lanRequest } from './net.js';

function attr(tag, name, value) {
    const n = Buffer.from(name);
    const v = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
    const head = Buffer.alloc(3);
    head[0] = tag;
    head.writeUInt16BE(n.length, 1);
    const len = Buffer.alloc(2);
    len.writeUInt16BE(v.length);
    return Buffer.concat([head, n, len, v]);
}

export function encodeIpp(operation, uri, { name = 'WORK', format, data } = {}) {
    const head = Buffer.from([1, 1, 0, 0, 0, 0, 0, 1, 1]);
    head.writeUInt16BE(operation, 2);
    const attrs = [attr(0x47, 'attributes-charset', 'utf-8'), attr(0x48, 'attributes-natural-language', 'en'),
        attr(0x45, 'printer-uri', uri), attr(0x42, 'requesting-user-name', 'WORK')];
    if (operation === 2) {
        attrs.push(attr(0x42, 'job-name', name));
        if (format) attrs.push(attr(0x49, 'document-format', format));
    }
    else attrs.push(attr(0x44, 'requested-attributes', 'all'));
    return Buffer.concat([head, ...attrs, Buffer.from([3]), data || Buffer.alloc(0)]);
}

export function decodeIpp(buf) {
    if (buf.length < 9 || ![1, 2].includes(buf[0])) throw new Error('Некорректный IPP ответ');
    const status = buf.readUInt16BE(2);
    const attributes = Object.create(null);
    let offset = 8, last = '';
    while (offset < buf.length) {
        const tag = buf[offset++];
        if (tag === 3) break;
        if (tag < 0x10) { last = ''; continue; }
        if (offset + 2 > buf.length) throw new Error('Обрезанный IPP ответ');
        const nl = buf.readUInt16BE(offset); offset += 2;
        if (offset + nl + 2 > buf.length) throw new Error('Обрезанный IPP атрибут');
        const name = nl ? buf.toString('utf8', offset, offset + nl) : last;
        offset += nl;
        const vl = buf.readUInt16BE(offset); offset += 2;
        if (offset + vl > buf.length) throw new Error('Обрезанное IPP значение');
        const value = (tag === 0x21 || tag === 0x23) && vl === 4 ? buf.readInt32BE(offset)
            : tag === 0x22 && vl === 1 ? !!buf[offset] : buf.toString('utf8', offset, offset + vl);
        offset += vl;
        if (name) (attributes[name] ??= []).push(value);
        last = name;
    }
    return { status, attributes };
}

export async function ippRequest(endpoint, cfg, options = {}) {
    const uri = new URL(endpoint);
    if (uri.protocol === 'http:') uri.protocol = 'ipp:';
    if (uri.protocol === 'https:') uri.protocol = 'ipps:';
    const request = encodeIpp(options.data ? 2 : 11, uri.href, options);
    const res = await lanRequest(endpoint, cfg, {
        method: 'POST', body: request, headers: { ...options.headers, 'content-type': 'application/ipp' },
        timeout: options.data ? 30_000 : 5000, signal: options.signal,
    });
    if (res.status !== 200) throw new Error('IPP HTTP ' + res.status);
    const parsed = decodeIpp(res.body);
    if (parsed.status > 0x00ff) throw new Error('IPP: ' + parsed.status.toString(16) + ' ' + (parsed.attributes['status-message'] || ''));
    return parsed.attributes;
}
