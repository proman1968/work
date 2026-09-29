import '../sources/reactor.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { FS } from '../sources/server/index.js';
import { $server } from '../sources/server/server.js';
import { createRequestHandler } from '../sources/host/http-server.js';
import { serverId } from '../sources/host/server-id.js';
import { isPrivateAddress, resolvePublicUrl } from '../sources/host/net-guard.js';
import { uidOfEmail } from '../sources/host/auth-methods.js';
import { closeIndexDb } from '../sources/host/index-db.js';

/**
 * Безопасность: каждая находка аудита — сценарий-эксплойт, который обязан не сработать.
 * Сервер поднимается в тесте на свободном порту поверх песочницы WORK.
 */

const ADMIN = 'AD00000000000001';
const USER = 'BE00000000000001';
const BOSS = 'CE00000000000001';

let tmp, prevCwd, server, base;
const keys = {};

function write(rel, content) {
    const full = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf-8');
}

function rsa() {
    const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    return { pair, pub: pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64') };
}

async function req(p, { method = 'GET', cookie, headers = {}, body, json } = {}) {
    const h = { 'x-work-wsid': 'test', ...headers };
    if (cookie)
        h.cookie = 'ssid=' + cookie;
    if (json !== undefined) {
        body = JSON.stringify(json);
        h['content-type'] = 'application/json';
        method = 'POST';
    }
    if (h['x-work-wsid'] === null)
        delete h['x-work-wsid'];
    const res = await fetch(base + encodeURI(p), { method, headers: h, body, redirect: 'manual' });
    const text = await res.text();
    const set = res.headers.get('set-cookie') || '';
    return { status: res.status, text, headers: res.headers, ssid: set.match(/ssid=([^;]+)/)?.[1] };
}

/** Сессия вошедшего пользователя без UI: как после успешной проверки подписи. */
async function sessionOf(uid) {
    const s = $server.get_session();
    const user = await (await WORK.$users).get_item('//' + uid);
    $server.signIn(s, user);
    return s.ssid;
}

before(async () => {
    prevCwd = process.cwd();
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-sec-'));
    for (const u of [ADMIN, USER, BOSS])
        keys[u] = rsa();
    write('$server/class.js', `export default { label: 'SEC', '#security': { ADMINS: ['${ADMIN}'] } }`);
    write('$server/$folder/class.js', `export default {}`);
    write('$server/$folder/$class/class.js', `export default {}`);
    write('$server/$folder/$file/class.js', `export default {}`);
    write('$server/$folder/$file/$md/class.js', `export default {}`);
    for (const u of [ADMIN, USER, BOSS])
        write(`USERS/${u}/$user/class.js`, `export default { label: 'U${u.slice(0, 2)}', email: '${u}@x', keys: { '1': '${keys[u].pub}' } }`);
    write('ORG/$class/class.js', `export default { label: 'ORG', '#security': { BOSSES: ['${BOSS}'] } }`);
    write('ORG/DEPT/$class/class.js', `export default {
    label: 'DEPT',
    ROLES: { CUSTOMER: { label: 'Покупатель' } },
    '#security': { USERS: ['${USER}'], CUSTOMERS: ['${serverId}'] }
}`);
    write('ORG/DEPT/$class/USER/work.md', 'рабочий файл');
    write('ORG/DEPT/$class/BOSS/boss.md', 'файл руководителя');
    write('ORG/DEPT/$class/CUSTOMER/price.md', 'прайс для покупателей');
    write('ORG/DEPT/$class/logs/2026-01-01/1.x.logs', JSON.stringify({ time: 1, sender: USER, content: 'моё' }));
    write('ORG/DEPT/$class/logs/2026-01-01/2.x.logs', JSON.stringify({ time: 2, sender: BOSS, content: 'чужое' }));
    write('NODES/$node/class.js', `export default { label: 'Сеть' }`);
    process.chdir(tmp);
    globalThis.WORK = new $server();
    server = http.createServer(createRequestHandler());
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    base = 'http://127.0.0.1:' + server.address().port;
    // узел «сам к себе»: ключ нашего сервера, представитель USER назначен на роль CUSTOMER узла
    const { serverKeys, fingerprint } = await import('../sources/modules/nodes/identity.js');
    const pub = serverKeys().publicKey;
    write('NODES/SELF/$node/class.js', `export default {
    label: 'SELF', host_id: '${serverId}', origin: '${base}', publicKey: '${pub}',
    fingerprint: '${fingerprint(pub)}', status: 'active',
    ROLES: { CUSTOMER: { label: 'Покупатель' } },
    '#security': { CUSTOMERS: ['${USER}'] }
}`);
    WORK.reset();
});

after(async () => {
    await new Promise(r => server?.close(r));
    closeIndexDb();
    process.chdir(prevCwd);
    try { await fsp.rm(tmp, { recursive: true, force: true }); } catch { /* занято */ }
});

describe('аутентификация', () => {
    it('login_start не даёт личность без подписи (обход входа)', async () => {
        const start = await req(`/?user_login_start&uid=${ADMIN}&challengeId=c1`);
        assert.equal(start.status, 200);
        const denied = await req('/?security_log', { cookie: start.ssid });
        assert.equal(denied.status, 400);
        assert.match(denied.text, /Доступ запрещён/);
    });

    it('вход по подписи выдаёт новый ssid, старый больше не действует', async () => {
        const start = await req(`/?user_login_start&uid=${USER}&challengeId=c2`);
        const challenge = start.text;
        const signature = crypto.sign('sha256', Buffer.from(challenge), keys[USER].pair.privateKey).toString('base64');
        const fin = await req(`/?user_login_finish&uid=${USER}&time=1&challengeId=c2`, { cookie: start.ssid, json: { signature } });
        assert.equal(fin.status, 200, fin.text);
        assert.ok(fin.ssid && fin.ssid !== start.ssid, 'ssid ротируется при входе');
        assert.equal($server.sessions[fin.ssid]?.uid, USER);
        assert.equal($server.sessions[start.ssid], undefined, 'старый ssid удалён');
    });

    it('подпись чужим ключом не принимается', async () => {
        const start = await req(`/?user_login_start&uid=${ADMIN}&challengeId=c3`);
        const signature = crypto.sign('sha256', Buffer.from(start.text), keys[USER].pair.privateKey).toString('base64');
        const fin = await req(`/?user_login_finish&uid=${ADMIN}&time=1&challengeId=c3`, { cookie: start.ssid, json: { signature } });
        assert.equal(fin.status, 400);
        assert.notEqual($server.sessions[start.ssid]?.uid, ADMIN);
    });

    it('после перезапуска: старая cookie нашего формата принимается, вход не рвётся при разных cookie шагов', async () => {
        // страница открыта до перезапуска: cookie формата сервера, сессии в памяти нет
        const stale = $server.newSessionId();
        const parallel = await Promise.all([1, 2, 3].map(() => req('/?id', { cookie: stale })));
        assert.ok(parallel.every(r => !r.ssid), 'все параллельные запросы в одной сессии — новая cookie не выдаётся');
        assert.ok($server.sessions[stale], 'сессия поднята по старому идентификатору');
        // шаги входа пришли с разными cookie (гонка Set-Cookie параллельных запросов)
        const start = await req(`/?user_login_start&uid=${USER}&challengeId=race-1`, { cookie: $server.newSessionId() });
        const signature = crypto.sign('sha256', Buffer.from(start.text), keys[USER].pair.privateKey).toString('base64');
        const fin = await req(`/?user_login_finish&uid=${USER}&time=1&challengeId=race-1`, { cookie: stale, json: { signature } });
        assert.equal(fin.status, 200, fin.text);
        assert.ok(fin.ssid && fin.ssid !== stale, 'при входе ssid всё равно меняется (защита от фиксации)');
        assert.equal($server.sessions[fin.ssid]?.uid, USER);
        // challenge одноразовый
        const again = await req(`/?user_login_finish&uid=${USER}&time=1&challengeId=race-1`, { json: { signature } });
        assert.match(again.text, /Challenge expired or missing/);
    });

    it('неизвестный ssid из cookie не принимается (фиксация сессии)', async () => {
        const r = await req('/?id', { cookie: 'attacker-chosen-id' });
        assert.ok(r.ssid && r.ssid !== 'attacker-chosen-id');
        assert.ok(r.ssid.length >= 32, 'криптостойкий идентификатор');
        assert.equal($server.sessions['attacker-chosen-id'], undefined);
        assert.match(r.headers.get('set-cookie'), /HttpOnly/);
        assert.match(r.headers.get('set-cookie'), /SameSite=Lax/);
    });

    it('регистрация: uid привязан к email, чужой uid отвергается', async () => {
        const r = await req('/?user_register_start', { json: { uid: ADMIN, email: 'attacker@evil' } });
        assert.equal(r.status, 400);
        assert.match(r.text, /Неверный uid/);
        assert.equal(uidOfEmail('a@b').length, 16);
    });

    it('регистрация: код из 6 цифр, не больше 5 попыток', async () => {
        const email = 'new@user.test';
        const start = await req('/?user_register_start', { json: { uid: uidOfEmail(email), email } }).catch(e => e);
        // почтовый сервер в песочнице не настроен — код всё равно выдан в сессии
        const session = Object.values($server.sessions).find(s => s.registration?.email === email);
        assert.ok(session, 'регистрация начата ' + start.text);
        assert.match(session.registration.code, /^\d{6}$/);
        for (let i = 0; i < 5; i++) {
            const r = await req('/?user_register_process&code=000000', { cookie: session.ssid, json: {} });
            assert.equal(r.status, 400);
        }
        const blocked = await req('/?user_register_process&code=' + session.registration?.code, { cookie: session.ssid, json: {} });
        assert.equal(blocked.status, 400);
        assert.match(blocked.text, /попыток|истёк/);
    });
});

describe('шлюз методов', () => {
    it('сеттеры, внутренние и служебные члены недоступны', async () => {
        const admin = await sessionOf(ADMIN);
        for (const m of ['fs', 'settings', 'DATA', '_roleIds', 'importScript', 'constructor', 'signIn', 'save_to_history', 'getFolderToSaveFile', 'real_dir'])
            assert.equal((await req('/?' + m, { cookie: admin })).status, 400, m);
        const set = await req('/?DATA', { cookie: admin, json: { '#security': { ADMINS: ['X'] } } });
        assert.equal(set.status, 400);
        assert.ok(!WORK.DATA['#security']?.ADMINS?.includes('X'), 'DATA не подменён');
        assert.equal((await req('/@settings', { cookie: admin })).status, 400);
    });

    it('npm и proxy не доступны без прав', async () => {
        const user = await sessionOf(USER);
        assert.match((await req('/?npm&module=left-pad', { cookie: user })).text, /Доступ запрещён/);
        assert.match((await req('/?proxy&meta=1&url=http://127.0.0.1/', {})).text, /Доступ запрещён/);
        assert.match((await req('/?proxy&meta=1&url=http://127.0.0.1/', { cookie: user })).text, /внутренняя сеть/);
    });

    it('CSRF: изменение без заголовка клиента / с чужого Origin отвергается', async () => {
        const user = await sessionOf(USER);
        const target = '/ORG/DEPT?save_file&filename=csrf.md&role=USER';
        const cross = await req(target, { cookie: user, headers: { 'x-work-wsid': null, origin: 'https://evil.example' }, method: 'POST', body: 'x' });
        assert.match(cross.text, /Доступ запрещён/);
        const bare = await req(target, { cookie: user, headers: { 'x-work-wsid': null }, method: 'POST', body: 'x' });
        assert.match(bare.text, /Доступ запрещён/);
        const ok = await req(target, { cookie: user, method: 'POST', body: 'x', headers: { 'content-type': 'text/plain' } });
        assert.equal(ok.status, 200, ok.text);
        assert.ok(fs.existsSync(path.join(tmp, 'ORG/DEPT/$class/USER/text/csrf.md')));
    });
});

describe('запись: пути и исполняемое', () => {
    it('выход за пределы папки через folder / filename невозможен', async () => {
        const user = await sessionOf(USER);
        const up = await req('/ORG/DEPT?save_file&filename=x.md&folder=../../../..&role=USER', { cookie: user, method: 'POST', body: 'x', headers: { 'content-type': 'text/plain' } });
        assert.equal(up.status, 400);
        assert.match(up.text, /Недопустимый путь/);
        const name = await req('/ORG/DEPT?save_file&filename=../../../../$server/class.js&role=USER', { cookie: user, method: 'POST', body: 'export default {}', headers: { 'content-type': 'text/plain' } });
        assert.ok(!fs.readFileSync(path.join(tmp, '$server/class.js'), 'utf-8').startsWith('export default {}'), 'корневой class.js не перезаписан ' + name.text);
        assert.match(fs.readFileSync(path.join(tmp, 'ORG/DEPT/$class/class.js'), 'utf-8'), /USERS/, 'class.js класса не перезаписан');
        assert.ok(fs.existsSync(path.join(tmp, 'ORG/DEPT/$class/USER/text/class.js')), 'файл лёг в зону пользователя как обычный файл');
    });

    it('в своей зоне нельзя создать $-папку с class.js (исполнение кода)', async () => {
        const user = await sessionOf(USER);
        const r = await req('/ORG/DEPT?save_file&filename=class.js&folder=$handler&role=USER', { cookie: user, method: 'POST', body: 'export default { execute(){} }', headers: { 'content-type': 'text/plain' } });
        assert.equal(r.status, 400);
        assert.ok(!fs.existsSync(path.join(tmp, 'ORG/DEPT/$class/USER/$handler')));
    });
});

describe('чтение', () => {
    it('Range не обходит проверку доступа', async () => {
        const r = await req('/ORG/DEPT/$class/BOSS/boss.md', { headers: { range: 'bytes=0-3' } });
        assert.notEqual(r.status, 206);
        assert.match(r.text, /Доступ запрещён|Нет доступа/);
    });

    it('USER не видит зону BOSS, BOSS сверху видит', async () => {
        const user = await sessionOf(USER);
        const boss = await sessionOf(BOSS);
        assert.match((await req('/ORG/DEPT/$class/BOSS/boss.md', { cookie: user })).text, /Доступ запрещён/);
        assert.equal((await req('/ORG/DEPT/$class/BOSS/boss.md', { cookie: boss })).text, 'файл руководителя');
        assert.equal((await req('/ORG/DEPT/$class/USER/work.md', { cookie: user })).text, 'рабочий файл');
    });

    it('info(deep) не показывает недоступное', async () => {
        const user = await sessionOf(USER);
        const r = JSON.parse((await req('/ORG/DEPT/$class?info&deep=1&items=entries', { cookie: user })).text);
        const ids = (r.entries || []).map(e => e.id);
        assert.ok(ids.includes('USER'));
        assert.ok(!ids.includes('BOSS'), 'зона BOSS скрыта: ' + ids);
    });

    it('лента точки: USER получает только свои записи', async () => {
        const user = await sessionOf(USER);
        const rows = JSON.parse((await req('/ORG/DEPT?read_log_bodies&day=2026-01-01', { cookie: user })).text);
        assert.deepEqual(rows.map(r => r.content), ['моё']);
    });

    it('активное содержимое из зоны отдаётся в песочнице', async () => {
        write('ORG/DEPT/$class/USER/page.html', '<script>alert(1)</script>');
        (await WORK.get_item('/ORG/DEPT/$class/USER')).reset();
        const user = await sessionOf(USER);
        const r = await req('/ORG/DEPT/$class/USER/page.html', { cookie: user });
        const csp = r.headers.get('content-security-policy');
        assert.match(csp, /^sandbox /, 'песочница');
        assert.match(csp, /allow-scripts/, 'скрипты презентаций работают');
        assert.doesNotMatch(csp, /allow-same-origin/, 'но не в нашем источнике: нет доступа к окну WORK и сессии');
        assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    });
});

describe('исходящие запросы (SSRF)', () => {
    it('частные и служебные адреса запрещены', async () => {
        for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.1', '172.16.0.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:127.0.0.1'])
            assert.equal(isPrivateAddress(ip), true, ip);
        assert.equal(isPrivateAddress('8.8.8.8'), false);
        await assert.rejects(resolvePublicUrl('http://localhost/'), /внутренняя сеть/);
        await assert.rejects(resolvePublicUrl('file:///etc/passwd'), /http и https/);
    });
});

describe('сеть WORK: узлы', () => {
    it('карточка узла публикуется', async () => {
        const card = JSON.parse((await req('/.well-known/work-node')).text);
        assert.equal(card.protocol, 'work-node/1');
        assert.equal(card.id, serverId);
        assert.ok(card.publicKey && card.fingerprint);
        assert.ok(card.roles.some(r => r.id === 'USER'));
        assert.ok(!card.roles.some(r => r.id === 'ADMIN'), 'роли только для пользователей не публикуются');
    });

    it('представитель действует на узле в своей роли', async () => {
        const user = await sessionOf(USER);
        const r = await req('/NODES/SELF?remote&as=CUSTOMER&path=/ORG/DEPT/$class/CUSTOMER/price.md&method=read_text', { cookie: user, json: {} });
        assert.equal(r.status, 200, r.text);
        assert.equal(r.text, 'прайс для покупателей');
    });

    it('узел не выходит за назначенную роль и точку', async () => {
        const user = await sessionOf(USER);
        const r = await req('/NODES/SELF?remote&as=CUSTOMER&path=/ORG/DEPT/$class/USER/work.md&method=read_text', { cookie: user, json: {} });
        assert.match(r.text, /Доступ запрещён/);
    });

    it('не представитель не может действовать от имени нашего сервера', async () => {
        const boss = await sessionOf(BOSS);
        const r = await req('/NODES/SELF?remote&as=CUSTOMER&path=/ORG/DEPT/$class/CUSTOMER/price.md&method=read_text', { cookie: boss, json: {} });
        assert.equal(r.status, 400);
        assert.match(r.text, /Доступ запрещён|Нет доступа/);
    });

    it('подпись, адресат и повтор проверяются', async () => {
        const { HEADERS, canonical, digestOf } = await import('../sources/modules/nodes/signing.js');
        const { sign } = await import('../sources/modules/nodes/identity.js');
        const url = '/ORG/DEPT/$class/CUSTOMER/price.md?read_text&role=CUSTOMER';
        const fields = { method: 'GET', url, audience: serverId, date: new Date().toISOString(), nonce: crypto.randomBytes(16).toString('base64url'), node: serverId, actor: USER, roles: 'CUSTOMER', digest: digestOf(null) };
        const headers = {
            [HEADERS.node]: serverId, [HEADERS.audience]: serverId, [HEADERS.date]: fields.date, [HEADERS.nonce]: fields.nonce,
            [HEADERS.digest]: fields.digest, [HEADERS.actor]: USER, [HEADERS.roles]: 'CUSTOMER', [HEADERS.signature]: sign(canonical(fields)),
            'x-work-wsid': null,
        };
        const send = h => fetch(base + encodeURI(url.split('?')[0]) + '?' + url.split('?')[1], { headers: Object.fromEntries(Object.entries(h).filter(([, v]) => v !== null)) }).then(r => r.text());
        assert.equal(JSON.parse(await send(headers)), 'прайс для покупателей');
        assert.match(await send(headers), /Доступ запрещён/, 'повтор того же nonce');
        const forged = { ...headers, [HEADERS.nonce]: crypto.randomBytes(16).toString('base64url') };
        assert.match(await send(forged), /Доступ запрещён/, 'подпись не совпадает с nonce');
        const otherRole = { ...headers, [HEADERS.roles]: 'USER' };
        assert.match(await send(otherRole), /Доступ запрещён/, 'роль изменена после подписи');
    });

    it('узел не видит внутренние зоны своего класса в реестре', async () => {
        const nodeItem = await WORK.get_item('/NODES/SELF');
        const session = { uid: serverId, $user: nodeItem, principal: { kind: 'node', id: serverId, roles: ['CUSTOMER'] } };
        write('NODES/SELF/$node/CUSTOMER/notes.md', 'наши внутренние заметки');
        nodeItem.reset();
        const notes = await nodeItem.meta_folder.get_item('CUSTOMER/notes.md');
        assert.equal(await nodeItem.canSee(notes, { session }), false);
    });

    it('роли только для пользователей узлу не выдаются', async () => {
        const dept = await WORK.get_item('/ORG/DEPT');
        const session = { uid: serverId, principal: { kind: 'node', id: serverId, roles: [] } };
        assert.deepEqual(await dept.roles({ session }), ['CUSTOMER']);
        const org = await WORK.get_item('/ORG');
        write('ORG/$class/class.js', `export default { label: 'ORG', '#security': { BOSSES: ['${BOSS}', '${serverId}'] } }`);
        org.reset();
        assert.deepEqual(await org.roles({ session }), [], 'BOSS не выдаётся узлу');
    });
});
