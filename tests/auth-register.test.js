/**
 * Регистрация/вход/выход (host/auth-methods.js — покрытие C1):
 * первый пользователь назначается во все базовые роли WORK, код подтверждения (интервал 30 с,
 * 5 отправок в час, срок 10 минут, попытки), срок challenge входа, лимит незавершённых входов,
 * отказы завершения регистрации и входа, выход (все сессии пользователя / анонимная).
 * WORK_CHALLENGE_TTL_MS — до импорта движка: 1000 мс, истечение видно без долгого ожидания.
 */
process.env.WORK_CHALLENGE_TTL_MS = '1000';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';

await import('../sources/reactor.js');
const { $server } = await import('../sources/server/server.js');
const { createRequestHandler } = await import('../sources/host/http-server.js');
const { uidOfEmail } = await import('../sources/host/auth-methods.js');
const { closeIndexDb } = await import('../sources/host/index-db.js');

const EMAIL1 = 'first@work.test', EMAIL2 = 'second@work.test';

let tmp, prevCwd, server, base;
let first, second; // { uid, publicKey, kp, ssid }

function write(rel, content) {
    const full = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf-8');
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
    const res = await fetch(base + encodeURI(p), { method, headers: h, body, redirect: 'manual' });
    const text = await res.text();
    const set = res.headers.get('set-cookie') || '';
    return { status: res.status, text, headers: res.headers, ssid: set.match(/ssid=([^;]+)/)?.[1] };
}

/** Сессия без cookie: свежая анонимная. */
async function anonSession() {
    const r = await req('/?id');
    assert.ok(r.ssid, 'новая сессия');
    return r.ssid;
}

/** Полный цикл регистрации: код → подпись challenge → завершение. */
async function register(email, extra = {}) {
    const uid = uidOfEmail(email);
    const s1 = await req('/?user_register_start', { json: { email } });
    assert.equal(s1.status, 200, s1.text);
    const session = Object.values($server.sessions).find(s => s.registration?.email === email);
    assert.ok(session, 'регистрация начата: ' + s1.text);
    assert.match(session.registration.code, /^\d{6}$/);
    const s2 = await req('/?user_register_process&code=' + session.registration.code, { cookie: session.ssid, json: {} });
    assert.equal(s2.status, 200, s2.text);
    assert.equal(session.credentials.uid, uid);
    assert.ok(session.credentials.challenge, 'challenge для подписи');
    const kp = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const publicKey = kp.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    const signature = crypto.sign('sha256', Buffer.from(session.credentials.challenge), kp.privateKey).toString('base64');
    const s3 = await req('/?user_register_finish', { cookie: session.ssid, json: {
        credentials: { uid, publicKey, time: extra.time || '1',
            ...(extra.name ? { name: extra.name } : {}), ...(extra.surname ? { surname: extra.surname } : {}),
            ...(extra.icon ? { icon: extra.icon } : {}) },
        signature,
    } });
    return { uid, publicKey, kp, session, res: s3 };
}

before(async () => {
    prevCwd = process.cwd();
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'work-reg-'));
    // БЕЗ #security: первый зарегистрированный сам назначается во все базовые роли
    write('$server/class.js', `export default { label: 'REG' }`);
    write('$server/$folder/class.js', `export default {}`);
    write('$server/$folder/$class/class.js', `export default {}`);
    write('$server/$folder/$file/class.js', `export default {}`);
    write('$server/$folder/$file/$md/class.js', `export default {}`);
    process.chdir(tmp);
    globalThis.WORK = new $server();
    server = http.createServer(createRequestHandler());
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    base = 'http://127.0.0.1:' + server.address().port;
});

after(async () => {
    await new Promise(r => server?.close(r));
    closeIndexDb();
    process.chdir(prevCwd);
    try { await fsp.rm(tmp, { recursive: true, force: true }); } catch { /* занято */ }
});

describe('регистрация: первый пользователь', () => {
    it('весь цикл: код → подпись challenge → пользователь с ключом и иконкой, назначен во все роли WORK', async () => {
        const icon = 'data:image/png;base64,' + Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64');
        first = await register(EMAIL1, { name: 'Первый', surname: 'Пользователь', icon });
        assert.equal(first.res.status, 200, first.res.text);
        // вошёл: живая сессия с его uid
        const ssid = Object.entries($server.sessions).find(([, s]) => s.uid === first.uid)?.[0];
        assert.ok(ssid, 'сессия подписана');
        first.ssid = ssid;
        // ключ сохранён у пользователя, метка из имени
        const u = await (await WORK.$users).get_item('//' + first.uid);
        assert.equal(u.DATA.keys['1'], first.publicKey);
        assert.match(u.DATA.label, /Первый/);
        // иконка — файл в кабинете
        assert.ok(fs.existsSync(path.join(tmp, 'USERS', first.uid, '$user', 'icon.png')), 'иконка записана');
        // первый пользователь назначен во все базовые роли WORK (#security создан с нуля)
        const data = await WORK.DATA;
        for (const role of ['ADMIN', 'BOSS', 'USER'])
            assert.ok(data['#security']?.[role]?.includes(first.uid), role + ' включает первого');
    });

    it('второй пользователь без имени — метка из адреса; в роли его не назначают', async () => {
        second = await register(EMAIL2, {});
        assert.equal(second.res.status, 200, second.res.text);
        const u = await (await WORK.$users).get_item('//' + second.uid);
        assert.equal(u.DATA.label, EMAIL2, 'пустые имя/фамилия — метка из email');
        const data = await WORK.DATA;
        assert.ok(!data['#security']?.ADMIN?.includes(second.uid), 'второй не назначается администратором');
    });
});

describe('регистрация: отказы завершения', () => {
    it('без подтверждения, чужой uid, без ключа/подписи, неверная подпись', async () => {
        // сессия вообще без подтверждения адреса
        const anon = await anonSession();
        assert.match((await req('/?user_register_finish', { cookie: anon, json: { credentials: {}, signature: 'x' } })).text,
            /не подтверждён/);
        // подтверждённая кодом сессия для остальных отказов
        const email = 'reject@work.test';
        const uid = uidOfEmail(email);
        await req('/?user_register_start', { json: { email } });
        const session = Object.values($server.sessions).find(s => s.registration?.email === email);
        assert.ok(session);
        const s2 = await req('/?user_register_process&code=' + session.registration.code, { cookie: session.ssid, json: {} });
        assert.equal(s2.status, 200, s2.text);
        const kp = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
        const publicKey = kp.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
        const signature = crypto.sign('sha256', Buffer.from(session.credentials.challenge), kp.privateKey).toString('base64');
        // чужой uid в теле
        assert.match((await req('/?user_register_finish', { cookie: session.ssid,
            json: { credentials: { uid: second.uid, publicKey, time: '1' }, signature } })).text, /uid не совпадает/);
        // без ключа/подписи
        assert.match((await req('/?user_register_finish', { cookie: session.ssid,
            json: { credentials: { uid, time: '1' }, signature: '' } })).text, /нет ключа или подписи/);
        // подпись чужого вызова
        const bad = crypto.sign('sha256', Buffer.from('не тот вызов'), kp.privateKey).toString('base64');
        assert.match((await req('/?user_register_finish', { cookie: session.ssid,
            json: { credentials: { uid, publicKey, time: '1' }, signature: bad } })).text, /registration failed/);
        // пользователь не создан
        assert.equal(await (await WORK.$users).get_item('//' + uid), null);
    });
});

describe('регистрация: код подтверждения', () => {
    it('без адреса — отказ; повтор в той же сессии — 30 секунд; 6-я отправка в час — отказ', async () => {
        assert.match((await req('/?user_register_start', { json: {} })).text, /Не указан email/);
        const email = 'throttle@work.test';
        const s1 = await req('/?user_register_start', { json: { email } });
        assert.equal(s1.status, 200, s1.text);
        const session = Object.values($server.sessions).find(s => s.registration?.email === email);
        assert.ok(session);
        // повтор из той же сессии — интервал 30 секунд
        assert.match((await req('/?user_register_start', { cookie: session.ssid, json: { email } })).text, /30 секунд/);
        // ещё четыре отправки свежими сессиями — проходит, шестая за час — отказ
        for (let i = 0; i < 4; i++)
            assert.equal((await req('/?user_register_start', { json: { email } })).status, 200);
        assert.match((await req('/?user_register_start', { json: { email } })).text, /Слишком много запросов кода/);
    });

    it('срок кода истёк; код не вводится без параметра', async () => {
        const email = 'stale@work.test';
        await req('/?user_register_start', { json: { email } });
        const session = Object.values($server.sessions).find(s => s.registration?.email === email);
        assert.ok(session);
        session.registration.at = Date.now() - 11 * 60 * 1000; // код живёт 10 минут
        assert.match((await req('/?user_register_process&code=000000', { cookie: session.ssid, json: {} })).text,
            /Срок действия.*истёк/);
        // код не передан вовсе — неверный код, а не падение
        const email2 = 'nocode@work.test';
        await req('/?user_register_start', { json: { email: email2 } });
        const s2 = Object.values($server.sessions).find(s => s.registration?.email === email2);
        assert.match((await req('/?user_register_process', { cookie: s2.ssid, json: {} })).text, /неверный проверочный код/);
    });
});

describe('вход: login_start', () => {
    it('без uid / без challengeId / длинный challengeId / незарегистрированный uid', async () => {
        assert.match((await req('/?user_login_start&challengeId=x')).text, /uid required/);
        assert.match((await req(`/?user_login_start&uid=${second.uid}`)).text, /challengeId required/);
        assert.match((await req(`/?user_login_start&uid=${second.uid}&challengeId=${'x'.repeat(65)}`)).text, /challengeId required/);
        assert.match((await req('/?user_login_start&uid=AB00000000000009&challengeId=y')).text, /User not registered/);
    });

    it('не больше 16 незавершённых входов на пользователя', async () => {
        for (let i = 1; i <= 16; i++) {
            const r = await req(`/?user_login_start&uid=${second.uid}&challengeId=lim${i}`);
            assert.equal(r.status, 200, r.text);
        }
        assert.match((await req(`/?user_login_start&uid=${second.uid}&challengeId=lim17`)).text,
            /Слишком много незавершённых входов/);
    });
});

describe('вход: срок challenge и подписи', () => {
    it('challenge истёк (TTL) — вход отклонён; истёкшие вычищаются при новом входе', async () => {
        const start = await req(`/?user_login_start&uid=${first.uid}&challengeId=exp-1`);
        assert.equal(start.status, 200, start.text);
        const signature = crypto.sign('sha256', Buffer.from(start.text), first.kp.privateKey).toString('base64');
        const anon = await anonSession();
        await new Promise(r => setTimeout(r, 1200)); // TTL challenge — 1000 мс
        const fin = await req(`/?user_login_finish&uid=${first.uid}&time=1&challengeId=exp-1`, { cookie: anon, json: { signature } });
        assert.match(fin.text, /Challenge expired/);
        assert.equal($server.sessions[anon]?.uid, undefined, 'личность не выдана');
        // новый вход вычищает истёкшие ожидания
        const re = await req(`/?user_login_start&uid=${first.uid}&challengeId=exp-2`);
        assert.equal(re.status, 200, re.text);
    });

    it('уже вошедшая сессия — вход без проверки; отказы: нет подписи, нет ключа на время, challenge чужого, неверная подпись', async () => {
        // сессия уже несёт uid — повторный вход не требует подписи
        assert.match((await req(`/?user_login_finish&uid=${first.uid}&time=1&challengeId=zz`, { cookie: first.ssid, json: {} })).text,
            /Вход выполнен/);
        const anon = await anonSession();
        // без подписи
        await req(`/?user_login_start&uid=${first.uid}&challengeId=d1`);
        assert.match((await req(`/?user_login_finish&uid=${first.uid}&time=1&challengeId=d1`, { cookie: anon, json: {} })).text,
            /Need signature/);
        // нет ключа на указанное время
        const s2 = await req(`/?user_login_start&uid=${first.uid}&challengeId=d2`);
        const sig2 = crypto.sign('sha256', Buffer.from(s2.text), first.kp.privateKey).toString('base64');
        assert.match((await req(`/?user_login_finish&uid=${first.uid}&time=999&challengeId=d2`, { cookie: anon, json: { signature: sig2 } })).text,
            /Need publicKey/);
        // challenge выдан другому пользователю
        const s3 = await req(`/?user_login_start&uid=${first.uid}&challengeId=d3`);
        const sig3 = crypto.sign('sha256', Buffer.from(s3.text), first.kp.privateKey).toString('base64');
        assert.match((await req(`/?user_login_finish&uid=${second.uid}&time=1&challengeId=d3`, { cookie: anon, json: { signature: sig3 } })).text,
            /issued for another user/);
        // подпись не того вызова
        const s4 = await req(`/?user_login_start&uid=${first.uid}&challengeId=d4`);
        const bad = crypto.sign('sha256', Buffer.from('не тот вызов'), first.kp.privateKey).toString('base64');
        assert.match((await req(`/?user_login_finish&uid=${first.uid}&time=1&challengeId=d4`, { cookie: anon, json: { signature: bad } })).text,
            /login failed/);
        assert.equal($server.sessions[anon]?.uid, undefined, 'личность не выдана');
    });
});

describe('выход', () => {
    it('вошедший: завершает все его сессии; анонимная сессия: чистая', async () => {
        // вторая сессия того же пользователя
        const s5 = await req(`/?user_login_start&uid=${first.uid}&challengeId=e1`);
        const sig5 = crypto.sign('sha256', Buffer.from(s5.text), first.kp.privateKey).toString('base64');
        const anon = await anonSession();
        const fin5 = await req(`/?user_login_finish&uid=${first.uid}&time=1&challengeId=e1`, { cookie: anon, json: { signature: sig5 } });
        assert.equal(fin5.status, 200, fin5.text);
        assert.equal(Object.values($server.sessions).filter(s => s.uid === first.uid).length, 2, 'две сессии пользователя');
        // выход из одной — завершены все
        const out = await req('/?user_exit', { cookie: first.ssid, json: { time: '1' } });
        assert.match(out.text, /Выход выполнен/);
        assert.equal(Object.values($server.sessions).filter(s => s.uid === first.uid).length, 0, 'все сессии завершены');
        // анонимная сессия: выход чистит её саму и слот time
        const anon2 = await anonSession();
        $server.sessions[anon2]['1'] = 'слот';
        const out2 = await req('/?user_exit', { cookie: anon2, json: { time: '1' } });
        assert.match(out2.text, /Выход выполнен/);
        assert.equal($server.sessions[anon2]['1'], undefined, 'слот time закрыт');
    });
});
