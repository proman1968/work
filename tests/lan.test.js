import '../sources/reactor.js';
import { it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import { FS } from '../sources/server/index.js';
import { $server } from '../sources/server/server.js';
import { parseCidr, allowedCidr } from '../sources/modules/lan/subnet.js';
import { lanRequest, resolveHost } from '../sources/modules/lan/net.js';
import { scan, probe } from '../sources/modules/lan/scan.js';
import { decodeIpp, ippRequest } from '../sources/modules/lan/ipp.js';
import { parseDns, dnsCandidates, parseAnnouncement } from '../sources/modules/lan/discovery.js';
import { execute } from '../sources/modules/lan/connectors.js';
import { register } from '../sources/modules/lan/register.js';
import * as store from '../sources/modules/lan/store.js';
import { closeIndexDb } from '../sources/host/index-db.js';
import { resolvePublicUrl } from '../sources/host/net-guard.js';
import { serviceTools } from '../sources/modules/agent/tools/services.js';

const cfg = { enabled: true, subnets: ['127.0.0.0/8'], maxScanHosts: 8 };
const session = { uid: 'admin' };
let tmp, prev, server, base, printCount = 0, deleteCount = 0, pageAttempts = 0, lastOdata;
function write(p, text) {
    const dest = path.join(tmp, p); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, text);
}
// Ответ тестового IPP-принтера (не реальное устройство).
function ippReply() {
    const attributes = [['printer-make-and-model', 'Test printer'], ['document-format-supported', 'application/pdf']];
    return Buffer.concat([Buffer.from([1, 1, 0, 0, 0, 0, 0, 1, 4]), ...attributes.map(([key, value]) => {
        const n = Buffer.from(key), v = Buffer.from(value), head = Buffer.alloc(3), len = Buffer.alloc(2);
        head[0] = 0x44; head.writeUInt16BE(n.length, 1); len.writeUInt16BE(v.length);
        return Buffer.concat([head, n, len, v]);
    }), Buffer.from([3])]);
}
before(async () => {
    prev = process.cwd();
    const tempRoot = path.join(process.env.TEMP || os.tmpdir(), 'opencode');
    await fsp.mkdir(tempRoot, { recursive: true });
    tmp = await fsp.mkdtemp(path.join(tempRoot, 'lan-test-'));
    write('#system/os.json', JSON.stringify(cfg));
    write('$server/class.js', `export default { '#security': { ADMINS: ['admin'] } }`);
    write('$server/$folder/class.js', 'export default {}');
    write('$server/$folder/$class/class.js', 'export default {}');
    write('$server/$folder/$class/$service/class.js', 'export default {}');
    write('$server/$folder/$file/class.js', 'export default {}');
    write('SERVICES/$service/class.js', 'export default {}');
    write('TARGET/$class/class.js', `export default { '#security': { USERS: ['worker'] } }`);
    process.chdir(tmp); globalThis.WORK = new $server();
    server = http.createServer(async (req, res) => {
        const chunks = []; for await (const c of req) chunks.push(c);
        const body = Buffer.concat(chunks), url = new URL(req.url, 'http://test');
        if (url.pathname === '/large') { res.end('x'.repeat(20000)); return; }
        if (url.pathname === '/redirect') { res.writeHead(302, { location: 'http://10.0.0.1/' }); res.end(); return; }
        if (url.pathname === '/slow') { setTimeout(() => res.end('late'), 100); return; }
        if (url.pathname === '/ipp/print') {
            if (body.readUInt16BE(2) === 2) { printCount++; assert.ok(body.includes(Buffer.from('%PDF'))); }
            res.setHeader('content-type', 'application/ipp'); res.end(ippReply()); return;
        }
        if (url.pathname === '/eSCL/ScannerCapabilities') {
            res.end('<scan:ScannerCapabilities>application/pdf</scan:ScannerCapabilities>'); return;
        }
        if (url.pathname === '/eSCL/ScannerStatus') { res.end('<ScannerStatus>Idle</ScannerStatus>'); return; }
        if (url.pathname === '/eSCL/ScanJobs') {
            assert.match(body.toString(), /ScanSettings/);
            res.writeHead(201, { location: '/eSCL/ScanJobs/1' }); res.end(); return;
        }
        if (url.pathname === '/eSCL/ScanJobs/1/NextDocument') {
            if (!pageAttempts++) { res.writeHead(503, { 'retry-after': '0' }); res.end(); return; }
            res.setHeader('content-type', 'application/pdf'); res.end('%PDF-scan'); return;
        }
        if (url.pathname === '/eSCL/ScanJobs/1' && req.method === 'DELETE') { deleteCount++; res.end(); return; }
        if (url.pathname.startsWith('/base/odata/standard.odata/')) {
            lastOdata = url;
            res.setHeader('content-type', 'application/json');
            if (url.pathname.endsWith('$metadata')) res.end('<EntitySet Name="Catalog_Товары"/>');
            else res.end(JSON.stringify({ value: [{ Description: 'Товар' }] }));
            return;
        }
        res.end('<title>Test device</title>');
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    base = 'http://127.0.0.1:' + server.address().port;
});
after(async () => {
    await new Promise(r => server.close(r));
    await new Promise(r => setTimeout(r, 300));
    closeIndexDb(); process.chdir(prev); await fsp.rm(tmp, { recursive: true, force: true });
});

it('CIDR валидируется строго, лимит хостов и границы подсети соблюдаются', async () => {
    assert.equal(parseCidr('192.168.4.7/24').count, 254);
    assert.equal(parseCidr('127.0.0.1/32').count, 1);
    for (const s of ['127..0.1', '127.0.0.1/24/2', '1.2.3.4/', '999.2.3.4']) assert.throws(() => parseCidr(s));
    assert.throws(() => allowedCidr('127.0.0.0/16', cfg), /слишком большая/);
    assert.throws(() => allowedCidr('192.168.1.1/32', cfg), /не разрешена/);
    await assert.rejects(resolveHost('8.8.8.8', cfg), /вне разрешённых/);
    await assert.rejects(resolvePublicUrl('http://[::ffff:127.0.0.1]/'), /внутренняя сеть/);
});
it('HTTP: лимит тела, полный timeout, отмена, отсутствие перехода по redirect', async () => {
    await assert.rejects(lanRequest(base + '/large', cfg, { maxBytes: 32 }), /лимит/);
    await assert.rejects(lanRequest(base + '/slow', cfg, { timeout: 10 }), /Таймаут/);
    await assert.rejects(lanRequest(base, cfg, { signal: AbortSignal.abort() }));
    assert.equal((await lanRequest(base + '/redirect', cfg)).status, 302);
});
it('TCP scan на loopback обнаруживает только открытый тестовый порт', async () => {
    const res = await scan('127.0.0.1/32', cfg, { ports: [server.address().port] });
    assert.equal(res.checked, 1); assert.equal(res.candidates.length, 1);
    assert.equal(res.candidates[0].confidence, 'port-only');
    assert.deepEqual((await ippRequest(base + '/ipp/print', cfg))['printer-make-and-model'], ['Test printer']);
    assert.equal((await probe('127.0.0.1', cfg, { url: base })).confidence, 'escl');
});
it('discovery: повреждённый DNS отклоняется, объявления не считаются подтверждённым протоколом', () => {
    const loop = Buffer.alloc(24); loop.writeUInt16BE(1, 6); loop[12] = 0xc0; loop[13] = 12;
    assert.throws(() => parseDns(loop), /DNS/);
    const rows = dnsCandidates([
        { type: 33, name: 'Printer._ipp._tcp.local', value: { target: 'printer.local', port: 631 } },
        { type: 1, name: 'printer.local', value: '127.0.0.1' },
        { type: 16, name: 'Printer._ipp._tcp.local', value: { ty: 'Office', rp: 'ipp/print' } },
    ], ip => ip === '127.0.0.1');
    assert.equal(rows[0].kind, 'printer'); assert.equal(rows[0].url, 'http://127.0.0.1:631/ipp/print');
    assert.equal(parseAnnouncement('HTTP/1.1 200 OK\r\nLocation: http://127.0.0.1/info\r\nST: printer', '127.0.0.1', 'ssdp')[0].confidence, 'advertised');
    assert.throws(() => decodeIpp(Buffer.from([1, 1, 0])), /IPP/);
});
it('кандидат регистрируется классом сервиса, повторная регистрация не перезаписывает', async () => {
    store.merge([{ host: '127.0.0.1', port: server.address().port, kind: 'web', url: base, label: 'Device' }]);
    const id = Object.keys(store.load())[0];
    const result = await register({ id, name: 'Device' }, { session });
    assert.equal(result.path, '/SERVICES/LAN/Device');
    const service = await WORK.get_item(result.path);
    assert.equal(service.DATA.lanKind, 'web'); assert.equal(typeof service.status, 'function');
    assert.equal((await service.status({ session })).status, 200);
    assert.ok((await serviceTools(session)).some(t => t.source?.service === result.path && t.readonly));
    assert.ok(!(await serviceTools({ uid: 'outsider' })).some(t => t.source?.service === result.path));
    await assert.rejects(register({ id, name: 'Device' }, { session }), /уже существует/);
    await assert.rejects(service.status({ session: { uid: 'outsider' } }), /Доступ запрещён/);
});
it('OData: имена сущностей, фильтры и лимит; сетевому узлу коннектор не выдаётся', async () => {
    const service = { DATA: { lanKind: 'onec', endpoint: base + '/base/odata/standard.odata/' }, canSee: async () => true };
    const result = await execute(service, 'query', { session, entity: 'Catalog_Товары', top: 900, filter: "Description eq 'Товар'" });
    assert.equal(result.value[0].Description, 'Товар'); assert.equal(lastOdata.searchParams.get('$top'), '500');
    assert.equal(lastOdata.searchParams.get('$filter'), "Description eq 'Товар'");
    await assert.rejects(execute(service, 'query', { session, entity: '../other' }), /имя сущности/);
    await assert.rejects(execute(service, 'query', { session: { uid: 'admin', principal: { kind: 'node' } } }), /локальный пользователь/);
});
it('eSCL скан сохраняется с правами получателя в WORK; задание очищается', async () => {
    const service = { DATA: { lanKind: 'scanner', endpoint: base + '/eSCL/' }, canSee: async () => true };
    const saved = await execute(service, 'scan', { session: { uid: 'worker' }, to: '/TARGET', role: 'USER' });
    assert.ok(saved.path.includes('/USER/'));
    const file = await WORK.get_item(saved.path);
    assert.equal((await file.load({ encoding: null })).toString(), '%PDF-scan');
    assert.equal(deleteCount, 1);
    assert.equal(pageAttempts, 2, 'страница запрошена повторно после 503');
    await assert.rejects(execute(service, 'scan', { session: { uid: 'outsider' }, to: '/TARGET', role: 'USER' }), /Доступ запрещён/);
    assert.equal(deleteCount, 1, 'без прав на сохранение задание не создаётся');
});
it('IPP печать проверяет доступ к документу и MIME до Print-Job', async () => {
    write('TARGET/$class/USER/doc.pdf', '%PDF-document');
    const folder = await WORK.get_item('/TARGET/$class/USER'); folder.reset();
    const service = { DATA: { lanKind: 'printer', endpoint: base + '/ipp/print' }, canSee: async () => true };
    await execute(service, 'print', { session: { uid: 'worker' }, path: '/TARGET/$class/USER/doc.pdf' });
    assert.equal(printCount, 1);
    await assert.rejects(execute(service, 'print', { session: { uid: 'outsider' }, path: '/TARGET/$class/USER/doc.pdf' }), /Доступ запрещён/);
    assert.equal(printCount, 1);
});
