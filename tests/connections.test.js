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

let tmp, prevCwd, tokenServer, tokenPort, lastForm;
const uid = 'U1';

before(async () => {
    prevCwd = process.cwd();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-conn-'));
    process.chdir(tmp);
    tokenServer = http.createServer((req, res) => {
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
