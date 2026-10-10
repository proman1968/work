/**
 * Разбор мультиплексированного потока docker exec (кадр: тип 1 байт, 3 паддинг, длина BE32).
 * Свой парсер вместо docker.modem.demuxStream — проще подменять в тестах.
 * @returns {Promise<{stdout:string, stderr:string, truncated:boolean}>}
 */
import { Transform } from 'node:stream';
export function demux(stream, maxBytes = 200_000) {
    return new Promise((resolve, reject) => {
        let out = '', err = '', truncated = false;
        let buf = Buffer.alloc(0);
        const push = chunk => {
            buf = Buffer.concat([buf, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
            while (buf.length >= 8) {
                const type = buf[0];
                const len = buf.readUInt32BE(4);
                if (buf.length < 8 + len)
                    break;
                const payload = buf.slice(8, 8 + len).toString('utf-8');
                buf = buf.slice(8 + len);
                // остатки после усечения не копим
                if (truncated)
                    continue;
                if (type === 2)
                    err += payload;
                else
                    out += payload;
                if (out.length + err.length > maxBytes) {
                    out = out.slice(0, maxBytes);
                    err = err.slice(0, Math.max(0, maxBytes - out.length));
                    truncated = true;
                }
            }
        };
        stream.on('data', push);
        stream.on('end', () => resolve({ stdout: out, stderr: err, truncated }));
        stream.on('error', reject);
    });
}

/** Один кадр docker-потока (для тестов и фейков). type: 1 — stdout, 2 — stderr. */
export function frame(type, text) {
    const payload = Buffer.isBuffer(text) ? text : Buffer.from(String(text), 'utf-8');
    const head = Buffer.alloc(8);
    head[0] = type;
    head.writeUInt32BE(payload.length, 4);
    return Buffer.concat([head, payload]);
}

/**
 * Тот же разбор, но stdout — сырыми байтами (скриншоты).
 * @returns {Promise<{stdout:Buffer, stderr:string, truncated:boolean}>}
 */
export function demuxBytes(stream, maxBytes = 5_000_000) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0, err = '', truncated = false;
        let buf = Buffer.alloc(0);
        const push = chunk => {
            buf = Buffer.concat([buf, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
            while (buf.length >= 8) {
                const type = buf[0];
                const len = buf.readUInt32BE(4);
                if (buf.length < 8 + len)
                    break;
                const payload = buf.slice(8, 8 + len);
                buf = buf.slice(8 + len);
                if (truncated)
                    continue;
                if (type === 2)
                    err += payload.toString('utf-8');
                else {
                    chunks.push(payload);
                    size += payload.length;
                }
                if (size > maxBytes || err.length > 100_000) {
                    truncated = true;
                }
            }
        };
        stream.on('data', push);
        stream.on('end', () => resolve({ stdout: Buffer.concat(chunks), stderr: err, truncated }));
        stream.on('error', reject);
    });
}

/**
 * Потоковый demux docker-кадров → сырой stdout (для VNC-моста: кадры режутся
 * на лету, stderr-кадры отбрасываются). Входящие байты (stdin) идут мимо.
 */
export function createDemuxStream() {
    let buf = Buffer.alloc(0);
    return new Transform({
        transform(chunk, _enc, cb) {
            buf = Buffer.concat([buf, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
            while (buf.length >= 8) {
                const type = buf[0];
                const len = buf.readUInt32BE(4);
                if (buf.length < 8 + len)
                    break;
                if (type === 1)
                    this.push(buf.slice(8, 8 + len));
                buf = buf.slice(8 + len);
            }
            cb();
        },
    });
}
