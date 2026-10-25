/**
 * VNC-просмотр (sources/modules/sandbox/vnc-proxy.js): маршруты, доступ
 * (свой/чужой/без сессии), статика noVNC, скриншот, takeover, мост сокетов.
 * Docker — фейк; живой нужен только для настоящего RFB-потока.
 */
import '../sources/reactor.js';
import { it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { $server } from '../sources/server/server.js';
import { setDockerForTests, resetDockerForTests } from '../sources/modules/sandbox/driver.js';
import { loadSandboxConfig } from '../sources/modules/sandbox/config.js';
import { ensureComputer, resetRegistryForTests, controlBy } from '../sources/modules/sandbox/manager.js';
import { handleComputerHttp, handleVncSocket, pipeSocket, pipeVnc } from '../sources/modules/sandbox/vnc-proxy.js';
import { frame } from '../sources/modules/sandbox/stream.js';
import { fakeDocker, PNG_1X1 } from './helpers/fake-docker.js';

let tmp, root, previous;
function write(p, data) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); }

function sess(uid) {
    const s = $server.get_session('');
    s.uid = uid;
    return s;
}
function req(url, s, method = 'GET', body = '') {
    return {
        url, method, body,
        headers: { cookie: s ? 'ssid=' + s.ssid : '', host: 'localhost' },
        socket: { remoteAddress: '127.0.0.1' },
    };
}
function res() {
    const r = { status: 0, headers: {}, chunks: [] };
    r.writeHead = (status, headers) => { r.status = status; r.headers = headers; };
    r.end = data => { r.chunks.push(Buffer.isBuffer(data) ? data : Buffer.from(String(data ?? ''))); };
    r.text = () => Buffer.concat(r.chunks).toString('utf-8');
    return r;
}
const readBody = async r => String(r.body || '');

before(async () => {
    previous = process.cwd();
    const tempRoot = path.join(process.env.TEMP || os.tmpdir(), 'opencode');
    await fsp.mkdir(tempRoot, { recursive: true });
    tmp = await fsp.mkdtemp(path.join(tempRoot, 'vnc-test-'));
    root = path.join(tmp, 'work');
    write(path.join(root, '$server/class.js'), `export default { '#security': { ADMIN: ['admin'] } }`);
    for (const p of ['$server/$folder', '$server/$folder/$class', '$server/$folder/$file']) write(path.join(root, p, 'class.js'), 'export default {}');
    process.chdir(root); globalThis.WORK = new $server();
    resetRegistryForTests();
});
after(async () => {
    resetDockerForTests(); resetRegistryForTests();
    await new Promise(r => setTimeout(r, 300));
    process.chdir(previous); await fsp.rm(tmp, { recursive: true, force: true });
});

it('страница, скриншот, takeover — свой компьютер', async () => {
    const docker = fakeDocker();
    setDockerForTests(docker);
    await ensureComputer(docker, 'user9', 'main', loadSandboxConfig());
    const s = sess('user9');

    const page = res();
    assert.equal(await handleComputerHttp(req('/~computer/main', s), page, new URL('http://x/~computer/main'), readBody), true);
    assert.equal(page.status, 200);
    assert.match(page.text(), /Компьютер main/);
    assert.match(page.text(), /\/~\/lib\/novnc\/core\/rfb\.js/);

    const shot = res();
    await handleComputerHttp(req('/~computer/main/shot.png', s), shot, new URL('http://x/~computer/main/shot.png'), readBody);
    assert.equal(shot.status, 200);
    assert.equal(shot.headers['Content-Type'], 'image/png');
    assert.ok(Buffer.concat(shot.chunks).equals(PNG_1X1));

    const take = res();
    await handleComputerHttp(req('/~computer/main/takeover', s, 'POST', '{"take":"human"}'), take, new URL('http://x/~computer/main/takeover'), readBody);
    assert.equal(take.status, 200);
    assert.equal(JSON.parse(take.text()).control, 'human');
    const back = res();
    await handleComputerHttp(req('/~computer/main/takeover', s, 'POST', '{"take":"agent"}'), back, new URL('http://x/~computer/main/takeover'), readBody);
    assert.equal(JSON.parse(back.text()).control, 'agent');
    assert.equal(controlBy((await ensureComputer(docker, 'user9', 'main', loadSandboxConfig())).id), 'agent');
    resetRegistryForTests();
});

it('F24: takeover с чужим origin — 403; своя страница и клиент без origin — как раньше', async () => {
    const docker = fakeDocker();
    setDockerForTests(docker);
    await ensureComputer(docker, 'user9', 'main', loadSandboxConfig());
    const s = sess('user9');
    // чужая страница: origin не совпадает с хостом — отказ до смены управления
    const evil = res();
    const evilReq = req('/~computer/main/takeover', s, 'POST', '{"take":"human"}');
    evilReq.headers.origin = 'https://evil.example';
    await handleComputerHttp(evilReq, evil, new URL('http://x/~computer/main/takeover'), readBody);
    assert.equal(evil.status, 403);
    assert.equal(controlBy((await ensureComputer(docker, 'user9', 'main', loadSandboxConfig())).id), 'agent', 'управление уехало чужой странице');
    // своя страница (origin совпадает) — работает
    const own = res();
    const ownReq = req('/~computer/main/takeover', s, 'POST', '{"take":"human"}');
    ownReq.headers.origin = 'http://localhost';
    await handleComputerHttp(ownReq, own, new URL('http://x/~computer/main/takeover'), readBody);
    assert.equal(own.status, 200);
    assert.equal(JSON.parse(own.text()).control, 'human');
    // не-браузерный клиент без origin — работает как раньше
    const plain = res();
    await handleComputerHttp(req('/~computer/main/takeover', s, 'POST', '{"take":"agent"}'), plain, new URL('http://x/~computer/main/takeover'), readBody);
    assert.equal(plain.status, 200);
    resetRegistryForTests();
});

it('F24: WS-подключение с чужим origin — отказ до подписок и VNC; потолок сообщения задан', async () => {
    const { onWebSocketConnect, sameOrigin, WS_MAX_PAYLOAD } = await import('../sources/host/websocket.js');
    assert.equal(sameOrigin({ headers: { origin: 'https://evil.example', host: 'ours' } }), false);
    assert.equal(sameOrigin({ headers: { origin: 'http://ours', host: 'ours' } }), true);
    assert.equal(sameOrigin({ headers: { host: 'ours' } }), true, 'не-браузерный клиент без origin');
    assert.equal(sameOrigin({ headers: { origin: 'мусор', host: 'ours' } }), false);
    assert.equal(WS_MAX_PAYLOAD, 1024 * 1024);
    // подключение с чужим origin закрывается 4403 — до сессии и VNC-обработчика дело не доходит
    const closes = [];
    const mkWs = () => ({ close: (code, reason) => closes.push([code, reason]), on() {} });
    onWebSocketConnect(mkWs(), { url: '/~computer/main/vnc', headers: { origin: 'https://evil.example', host: 'ours', cookie: 'ssid=x' } });
    onWebSocketConnect(mkWs(), { url: '/some/subscribe', headers: { origin: 'https://evil.example', host: 'ours', cookie: 'ssid=x' } });
    assert.deepEqual(closes, [[4403, 'чужой origin'], [4403, 'чужой origin']]);
});

it('F24: присутствие не рассылается анонимным сессиям', async () => {
    const { broadcastUserPath } = await import('../sources/host/websocket.js');
    const sent = [];
    const sock = readyState => ({ ws: { readyState, send: m => sent.push(m) } });
    const prevSessions = $server.sessions;
    $server.sessions = {
        anon: { $user: null, sockets: { s: sock(1) } },
        closed: { $user: { id: 'U2' }, sockets: { s: sock(0) } }, // не открыт — тоже мимо
        u1: { $user: { id: 'U1' }, sockets: { s: sock(1) } },
    };
    try {
        broadcastUserPath({ id: 'U9', short: '/ORG/Продажи' });
        assert.equal(sent.length, 1, 'получила только вошедшая с открытым сокетом: ' + JSON.stringify(sent));
        assert.deepEqual(JSON.parse(sent[0]), { path: '/ORG/Продажи', initiator: 'U9' });
    }
    finally {
        $server.sessions = prevSessions;
    }
});

it('F24: сообщение WS сверх потолка обрывается сервером (1009), обычное — живёт', async () => {
    const http = await import('node:http');
    const WebSocket = await import('ws');
    const { attachWebSocket } = await import('../sources/host/websocket.js');
    const srv = http.createServer(() => {});
    attachWebSocket(srv);
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const url = 'ws://127.0.0.1:' + srv.address().port;
    const opened = [];
    const track = ws => { opened.push(ws); return ws; };
    try {
        // обычное сообщение — соединение живо (сервер отвечает connect)
        const okCode = await new Promise((resolve, reject) => {
            const ws = track(new WebSocket.WebSocket(url));
            const timer = setTimeout(() => reject(new Error('connect не пришёл')), 4000);
            ws.on('message', m => { clearTimeout(timer); ws.close(); resolve(String(m)); });
            ws.on('error', reject);
        });
        assert.match(okCode, /"type":"connect"/);
        // сообщение сверх 1 МБ — сервер обрывает (too big), а не копит в памяти
        const bigCode = await new Promise((resolve, reject) => {
            const ws = track(new WebSocket.WebSocket(url));
            const timer = setTimeout(() => reject(new Error('обрыва не было')), 6000);
            ws.on('open', () => ws.send(Buffer.alloc(2 * 1024 * 1024, 0x61)));
            ws.on('close', (code) => { clearTimeout(timer); resolve(code || 1006); });
            ws.on('error', () => { /* close придет следом с кодом */ });
        });
        assert.equal(bigCode, 1009, 'гигантский кадр не обрезан сервером');
    }
    finally {
        for (const ws of opened) { try { ws.terminate(); } catch { /* уже */ } }
        srv.close();
        srv.closeAllConnections?.();
    }
});

it('доступ: без сессии 401, чужой — 403, админ видит чужой', async () => {
    const docker = fakeDocker();
    setDockerForTests(docker);
    await ensureComputer(docker, 'other1', 'main', loadSandboxConfig());

    const anon = res();
    await handleComputerHttp(req('/~computer/main', null), anon, new URL('http://x/~computer/main'), readBody);
    assert.equal(anon.status, 401);

    const alien = res();
    await handleComputerHttp(req('/~computer/main?owner=other1', sess('user9')), alien, new URL('http://x/~computer/main?owner=other1'), readBody);
    assert.equal(alien.status, 403);

    const admin = res();
    await handleComputerHttp(req('/~computer/main?owner=other1', sess('admin')), admin, new URL('http://x/~computer/main?owner=other1'), readBody);
    assert.equal(admin.status, 200);
    assert.match(admin.text(), /Компьютер main/);
    resetRegistryForTests();
});

it('noVNC-статика: rfb.js отдаётся, выход наружу — 404, чужие пути — мимо', async () => {
    setDockerForTests(fakeDocker());
    const s = sess('user9');
    const ok = res();
    await handleComputerHttp(req('/~/lib/novnc/core/rfb.js', s), ok, new URL('http://x/~/lib/novnc/core/rfb.js'), readBody);
    assert.equal(ok.status, 200);
    assert.match(ok.headers['Content-Type'], /javascript/);
    assert.match(ok.text(), /RFB/);
    const trav = res();
    await handleComputerHttp(req('/~/lib/novnc/../../package.json', s), trav, new URL('http://x/~/lib/novnc/package.json'), readBody);
    assert.equal(trav.status, 404);
    assert.equal(await handleComputerHttp(req('/SOME/path', s), res(), new URL('http://x/SOME/path'), readBody), false);
});

it('мост сокетов гоняет байты в обе стороны и закрывает пару', async () => {
    const a = new EventEmitter();
    const b = new EventEmitter();
    const aSent = [], bWrote = [];
    let aClosed = 0, bDestroyed = 0;
    a.send = d => aSent.push(d);
    a.close = () => { aClosed++; };
    b.write = d => bWrote.push(d);
    b.destroy = () => { bDestroyed++; };
    const unpipe = pipeSocket(a, b);
    a.emit('message', Buffer.from([1, 2, 3]));
    b.emit('data', Buffer.from([4, 5]));
    assert.deepEqual(bWrote.map(x => [...x]), [[1, 2, 3]]);
    assert.deepEqual(aSent.map(x => [...x]), [[4, 5]]);
    b.emit('end');
    assert.equal(aClosed, 1);
    a.emit('close');
    assert.equal(bDestroyed, 1);
    unpipe();
});

it('pipeVnc: кадры режутся, байты в контейнер идут как есть', async () => {
    const ws = new EventEmitter();
    const sent = [];
    ws.send = d => sent.push(Buffer.from(d));
    ws.close = () => {};
    const stream = new EventEmitter();
    const written = [];
    let piped = null;
    stream.write = d => { written.push(Buffer.from(d)); return true; };
    stream.pipe = dest => { piped = dest; return dest; };
    stream.unpipe = () => { piped = null; };
    const unpipe = pipeVnc(ws, stream);
    assert.ok(piped);
    // контейнер → браузер: два кадра, второй и мусор stderr-кадра отброшен
    piped.write(Buffer.concat([frame(1, 'RFB'), frame(2, 'шум'), frame(1, ' 003')]));
    await new Promise(r => setTimeout(r, 20));
    assert.equal(Buffer.concat(sent).toString(), 'RFB 003');
    // браузер → контейнер: сырые байты
    ws.emit('message', Buffer.from([3, 1, 0]));
    assert.deepEqual(written.map(b => [...b]), [[3, 1, 0]]);
    unpipe();
});

it('VNC-хендшейк: чужой URL — мимо; свой — мост без 44xx', async () => {
    const docker = fakeDocker();
    setDockerForTests(docker);
    await ensureComputer(docker, 'user9', 'main', loadSandboxConfig());
    const s = sess('user9');
    assert.equal(await handleVncSocket({ close() {} }, { url: '/something-else' }), false);

    const closes = [];
    const ws = new EventEmitter();
    ws.close = (code, reason) => closes.push(code);
    ws.send = () => {};
    await handleVncSocket(ws, { url: '/~computer/main/vnc', headers: { cookie: 'ssid=' + s.ssid } });
    assert.deepEqual(closes.filter(c => c >= 4400), []);
    resetRegistryForTests();
});
