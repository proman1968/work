/**
 * Доступность TCP-портов прикладных сервисов, которые WORK умеет регистрировать.
 */
import net from 'node:net';

export const PORTS = {
    80: 'http', 443: 'http', 8080: 'http', 8443: 'http',
    445: 'share',
    631: 'printer', 9100: 'printer',
    1433: 'sql', 5432: 'sql', 3306: 'sql',
    1540: '1c', 1541: '1c', 1545: '1c',
};

/** Соединиться с портом → открыт ли. */
export function tcpOpen(host, port, timeout = 600) {
    return new Promise(resolve => {
        const sock = new net.Socket();
        const done = ok => {
            sock.destroy();
            resolve(ok);
        };
        sock.setTimeout(timeout);
        sock.once('connect', () => done(true));
        sock.once('timeout', () => done(false));
        sock.once('error', () => done(false));
        sock.connect(port, host);
    });
}

/** Первые байты, которые сервер присылает сам (MySQL и т.п.). */
export function banner(host, port, timeout = 1500, hello = null) {
    return new Promise(resolve => {
        const sock = new net.Socket();
        const chunks = [];
        const done = () => {
            sock.destroy();
            resolve(Buffer.concat(chunks));
        };
        sock.setTimeout(timeout);
        sock.on('data', c => {
            chunks.push(c);
            if (Buffer.concat(chunks).length > 256)
                done();
        });
        sock.once('timeout', done);
        sock.once('error', done);
        sock.once('end', done);
        sock.connect(port, host, () => {
            if (hello)
                sock.write(hello);
        });
    });
}

/**
 * Пройти хосты × порты с ограничением параллельности → [{ host, port, kind }].
 * @param {string[]} hostList
 * @param {number[]} ports
 */
export async function scan(hostList, ports, { timeout = 600, concurrency = 128, signal } = {}) {
    const jobs = [];
    for (const h of hostList)
        for (const p of ports)
            jobs.push([h, p]);
    const found = [];
    let i = 0;
    const worker = async () => {
        while (i < jobs.length && !signal?.aborted) {
            const [h, p] = jobs[i++];
            if (await tcpOpen(h, p, timeout))
                found.push({ host: h, port: p, kind: PORTS[p] || 'tcp' });
        }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
    return found.sort((a, b) => a.host.localeCompare(b.host, undefined, { numeric: true }) || a.port - b.port);
}
