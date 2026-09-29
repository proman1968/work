import { hosts, allowedCidr } from './subnet.js';
import { pool, tcpOpen, resolveHost, portNumber, lanRequest } from './net.js';
import { ippRequest } from './ipp.js';

export const PROFILES = Object.freeze({
    common: [22, 80, 443, 445, 515, 631, 1433, 1540, 1541, 3306, 3389, 5432, 8080, 8443, 9100],
    printers: [80, 443, 515, 631, 9100],
    scanners: [80, 443, 8080],
    onec: [80, 443, 1540, 1541, 1545, ...Array.from({ length: 32 }, (_, i) => 1560 + i)],
    servers: [22, 80, 443, 445, 1433, 3306, 3389, 5432, 8001, 8080, 8443],
});

function candidate(host, port) {
    const kind = [631, 515, 9100].includes(port) ? 'printer' : [1540, 1541, 1545].includes(port) || port >= 1560 && port <= 1591 ? 'onec'
        : [1433, 3306, 5432].includes(port) ? 'sql' : port === 445 ? 'share'
            : [80, 443, 8001, 8080, 8443].includes(port) ? 'web' : port === 22 ? 'ssh' : port === 3389 ? 'rdp' : 'unknown';
    const protocol = ({ 631: 'ipp', 515: 'lpd', 9100: 'jetdirect', 22: 'ssh', 3389: 'rdp', 445: 'smb', 1433: 'mssql', 3306: 'mysql', 5432: 'postgres' })[port] || 'tcp';
    return { host, port, kind, label: host + ':' + port, confidence: 'port-only', via: 'tcp', info: { protocol } };
}

export async function scan(cidr, cfg, { profile = 'common', ports, signal, timeout = 700 } = {}) {
    cidr = allowedCidr(cidr, cfg);
    const selected = ports ?? PROFILES[profile];
    if (!Array.isArray(selected) || !selected.length || selected.length > 64)
        throw new Error('Укажите профиль или 1–64 порта');
    const ps = [...new Set(selected.map(portNumber))];
    const jobs = [...hosts(cidr)].flatMap(host => ps.map(port => ({ host, port })));
    if (jobs.length > 65536) throw new Error('Слишком много проверок за один запуск');
    const deadline = AbortSignal.timeout(60_000);
    const stop = signal ? AbortSignal.any([signal, deadline]) : deadline;
    const found = [];
    let checked = 0;
    try {
        await pool(jobs, 32, async ({ host, port }) => {
            if (await tcpOpen(host, port, { signal: stop, timeout: Math.min(3000, Math.max(100, timeout)) }))
                found.push(candidate(host, port));
            checked++;
        }, stop);
    }
    catch (e) {
        signal?.throwIfAborted();
        if (!deadline.aborted) throw e;
    }
    return { cidr, checked, total: jobs.length, partial: checked < jobs.length, candidates: found };
}

/** Только протокольные чтения: открытый порт ещё не доказывает тип устройства. */
export async function probe(host, cfg, { port = 80, url, signal } = {}) {
    const address = await resolveHost(host, cfg);
    if (url) {
        const target = new URL(url);
        if (await resolveHost(target.hostname, cfg) !== address) throw new Error('URL относится к другому устройству');
        port = Number(target.port) || (target.protocol === 'https:' ? 443 : 80);
    }
    port = portNumber(port);
    const result = candidate(host, port);
    result.open = await tcpOpen(address, port, { signal });
    if (!result.open) return result;
    const base = new URL(url || `${[443, 8443].includes(port) ? 'https' : 'http'}://${host}:${port}/`);
    if (![80, 443, 631, 8001, 8080, 8443].includes(port) && !url) return result;
    try {
        const res = await lanRequest(base, cfg, { signal });
        const text = res.body.toString('utf8');
        result.info.http = res.status;
        result.info.server = res.headers.server;
        result.info.title = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').slice(0, 200);
        if (result.info.title) result.label = result.info.title;
        result.url = base.href;
        if (/1c|1с|enterprise/i.test((res.headers.server || '') + text.slice(0, 10000))) {
            result.kind = 'onec'; result.confidence = 'http-hint';
        }
        if (/odata\/standard\.odata/i.test(base.pathname) && (res.headers['odata-version'] || /schemas\.microsoft\.com\/ado|EntitySet|odata\.context/.test(text))) {
            result.kind = 'onec'; result.confidence = 'odata';
        }
    }
    catch (e) { result.info.httpError = e.message; }
    if (port === 631 || base.pathname.includes('/ipp/')) {
        try {
            const endpoint = port === 631 && base.pathname === '/' ? new URL('/ipp/print', base).href : base.href;
            result.info.attributes = await ippRequest(endpoint, cfg, { signal });
            result.kind = 'printer'; result.confidence = 'ipp'; result.url = endpoint;
            result.label = result.info.attributes['printer-make-and-model']?.[0] || result.label;
        }
        catch (e) { result.info.ippError = e.message; }
    }
    try {
        const endpoint = new URL('/eSCL/', base);
        const res = await lanRequest(new URL('ScannerCapabilities', endpoint), cfg, { signal });
        if (res.status === 200 && /ScannerCapabilities/.test(res.body.toString('utf8'))) {
            result.kind = 'scanner'; result.confidence = 'escl'; result.url = endpoint.href;
            result.info.capabilities = res.body.toString('utf8').slice(0, 12000);
        }
    }
    catch { /* eSCL не поддерживается */ }
    return result;
}
