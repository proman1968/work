/** Подключения внешних сервисов: токен, OAuth2 (PKCE, callback, обновление токена), разрешения http_request. */
import '../sources/reactor.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import * as C from '../sources/modules/agent/connections.js';
import { connectTools } from '../sources/modules/agent/tools/connect.js';
import { decide } from '../sources/modules/agent/permissions.js';

let tmp, prevCwd, tokenServer, tokenPort, lastForm, tokenHits = 0;
const uid = 'U1';
const connDir = u => path.join(tmp, 'USERS', u, '$user', '#secret', 'connections');

before(async () => {
    prevCwd = process.cwd();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-conn-'));
    process.chdir(tmp);
    tokenServer = http.createServer((req, res) => {
        tokenHits++;
        let b = '';
        req.on('data', d => b += d);
        req.on('end', () => {
            lastForm = Object.fromEntries(new URLSearchParams(b));
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ access_token: 'AT-' + lastForm.grant_type, refresh_token: 'RT', expires_in: lastForm.grant_type === 'authorization_code' ? 1 : 3600 }));
        });
    });
    await new Promise(r => tokenServer.listen(0, r));
    tokenPort = tokenServer.address().port;
    C.PROVIDERS.google.token_url = 'http://127.0.0.1:' + tokenPort + '/token';
});

after(() => {
    tokenServer.close();
    process.chdir(prevCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
});

describe('подключения', () => {
    it('токен: сохраняется вне ленты, список без секретов, заголовок авторизации', async () => {
        await C.start({ uid, provider: 'token', name: 'crm', token: 'SECRET', base_url: 'https://api.example.com/v1' });
        const list = await C.list(uid);
        assert.equal(list[0].name, 'crm');
        assert.ok(!JSON.stringify(list).includes('SECRET'));
        const a = await C.authHeaders(uid, 'crm');
        assert.equal(a.headers.Authorization, 'Bearer SECRET');
        assert.ok(fs.existsSync(path.join(tmp, 'USERS', uid, '$user', '#secret', 'connections', 'crm.json')));
    });

    it('на диске токены зашифрованы; открытый файл старого формата читается и сразу перешифровывается', async () => {
        const dir = connDir(uid);
        const sealed = JSON.parse(fs.readFileSync(path.join(dir, 'crm.json'), 'utf-8'));
        assert.equal(sealed.v, 2);
        assert.ok(!JSON.stringify(sealed).includes('SECRET'), 'токен лежит открытым текстом');
        fs.writeFileSync(path.join(dir, 'old.json'), JSON.stringify({ type: 'token', provider: 'token', token: 'LEGACY-T', header: 'Authorization', base_url: 'https://api.example.com', scopes: [], connected: 1 }));
        assert.equal((await C.authHeaders(uid, 'old')).headers.Authorization, 'Bearer LEGACY-T');
        const migrated = fs.readFileSync(path.join(dir, 'old.json'), 'utf-8');
        assert.ok(!migrated.includes('LEGACY-T'), 'открытый файл не перешифрован');
        assert.equal(JSON.parse(migrated).v, 2);
        assert.equal((await C.authHeaders(uid, 'old')).headers.Authorization, 'Bearer LEGACY-T');
    });

    it('файл подключения нельзя подсунуть другому пользователю или под другим именем; повреждённый — понятная ошибка, list не падает', async () => {
        const src = path.join(connDir(uid), 'crm.json');
        fs.mkdirSync(connDir('U2'), { recursive: true });
        fs.copyFileSync(src, path.join(connDir('U2'), 'crm.json'));
        await assert.rejects(C.authHeaders('U2', 'crm'), /не расшифровать/);
        fs.copyFileSync(src, path.join(connDir(uid), 'copy.json'));
        await assert.rejects(C.authHeaders(uid, 'copy'), /не расшифровать/);
        const box = JSON.parse(fs.readFileSync(src, 'utf-8'));
        box.data = Buffer.from('испорчено').toString('base64');
        fs.writeFileSync(path.join(connDir(uid), 'broken.json'), JSON.stringify(box));
        await assert.rejects(C.authHeaders(uid, 'broken'), /повреждена|не расшифровать/);
        const warn = console.warn;
        console.warn = () => {};
        try {
            const names = (await C.list(uid)).map(c => c.name);
            assert.ok(names.includes('crm'));
            assert.ok(!names.includes('broken') && !names.includes('copy'));
        }
        finally {
            console.warn = warn;
        }
        assert.equal(await C.authHeaders(uid, 'nope').catch(e => e.message.includes('нет подключения')), true);
    });

    it('WORK_SECRET_KEY добавили позже: записи под ключом сервера читаются и перешифровываются новым ключом', async () => {
        const prev = process.env.WORK_SECRET_KEY;
        await C.start({ uid: 'U3', provider: 'token', name: 'late', token: 'LATE-T', base_url: 'https://api.example.com' });
        const file = path.join(connDir('U3'), 'late.json');
        const kidBefore = JSON.parse(fs.readFileSync(file, 'utf-8')).kid;
        process.env.WORK_SECRET_KEY = 'ab'.repeat(32);
        try {
            assert.equal((await C.authHeaders('U3', 'late')).headers.Authorization, 'Bearer LATE-T');
            const after = JSON.parse(fs.readFileSync(file, 'utf-8'));
            assert.notEqual(after.kid, kidBefore, 'запись не перешифрована новым ключом');
            assert.ok(!JSON.stringify(after).includes('LATE-T'));
            assert.equal((await C.authHeaders('U3', 'late')).headers.Authorization, 'Bearer LATE-T');
        }
        finally {
            if (prev === undefined)
                delete process.env.WORK_SECRET_KEY;
            else
                process.env.WORK_SECRET_KEY = prev;
        }
    });

    it('OAuth2: без клиента — просьба создать; с клиентом — auth_url с PKCE; callback → токен; истёкший — обновляется', async () => {
        const need = await C.start({ uid, provider: 'google', scopes: ['calendar'], origin: 'http://localhost:8001' });
        assert.equal(need.need_client, true);
        let done = 0;
        const r = await C.start({ uid, provider: 'google', scopes: ['calendar'], origin: 'http://localhost:8001', client_id: 'CID', client_secret: 'CS', onDone: () => done++ });
        const u = new URL(r.auth_url);
        assert.equal(u.searchParams.get('redirect_uri'), 'http://localhost:8001/oauth/callback');
        assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
        assert.equal(u.searchParams.get('scope'), 'https://www.googleapis.com/auth/calendar.events');
        const html = await C.callback({ code: 'CODE', state: u.searchParams.get('state') });
        assert.match(html, /Подключено/);
        assert.equal(done, 1);
        assert.equal(lastForm.code_verifier.length > 40, true);
        await new Promise(r2 => setTimeout(r2, 1100)); // expires_in: 1 → истёк
        const a = await C.authHeaders(uid, 'google');
        assert.equal(a.headers.Authorization, 'Bearer AT-refresh_token');
        assert.match(await C.callback({ code: 'x', state: 'чужой' }), /устарела/);
    });

    it('внутренняя сеть запрещена для http_request', () => {
        for (const bad of ['http://localhost:8001/x', 'http://127.0.0.1/', 'http://192.168.1.5/', 'http://10.0.0.1/', 'file:///etc/passwd'])
            assert.throws(() => C.assertPublicUrl(bad));
        assert.ok(C.assertPublicUrl('https://www.googleapis.com/calendar/v3'));
    });

    it('предпроверка ловит IPv6-формы внутренних адресов (::ffff:127.0.0.1 и т.п.)', () => {
        for (const bad of ['http://[::ffff:7f00:1]/', 'http://[::ffff:a00:1]/', 'http://[::ffff:c0a8:101]/', 'http://[fd00::1]/', 'http://[::1]/', 'http://169.254.169.254/latest/meta-data'])
            assert.throws(() => C.assertPublicUrl(bad), /внутренней сети/, bad);
    });

    it('http_request: внутренний адрес отклоняется сразу и в относительном url поверх base_url подключения', async () => {
        const t = connectTools.find(x => x.name === 'http_request');
        const ctx = { session: { uid } };
        const hitsBefore = tokenHits;
        await assert.rejects(t.run({ method: 'GET', url: 'http://127.0.0.1:' + tokenPort + '/token' }, ctx), /внутренней сети/);
        await assert.rejects(t.run({ method: 'GET', url: 'http://[::ffff:7f00:1]/' }, ctx), /внутренней сети/);
        await C.start({ uid, provider: 'token', name: 'lan', token: 'T', base_url: 'http://192.168.0.5/api' });
        await assert.rejects(t.run({ connection: 'lan', method: 'GET', url: '/x' }, ctx), /внутренней сети/);
        assert.equal(tokenHits, hitsBefore, 'локальный сервер не должен получать запросов от http_request');
    });

    it('http_request: чтение — сразу, изменение — всегда вопрос без «разрешить всегда» (даже в авто и после allowed)', async () => {
        const t = connectTools.find(x => x.name === 'http_request');
        const host = { mode: 'auto', allowed: new Set(['http_request']) };
        assert.equal((await decide(t, { method: 'GET', url: '/x' }, { host })).verdict, 'allow');
        const d = await decide(t, { method: 'POST', url: '/calendar/v3/calendars/primary/events', reason: 'Создать событие' }, { host });
        assert.equal(d.verdict, 'ask');
        assert.equal(d.noAlways, true);
        assert.match(d.reason, /Создать событие/);
    });
});
