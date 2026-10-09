/** secret-box: AES-256-GCM для секретов на диске — формат, привязка к владельцу, ключи (env / node-key), ротация. */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { seal, open, isSealed } from '../sources/host/secret-box.js';

let tmp, prevCwd;
const prevEnv = process.env.WORK_SECRET_KEY;
const ctx = { info: 'work-connections', aad: 'U1/crm' };
const randomKey = () => crypto.randomBytes(32).toString('hex');

before(() => {
    prevCwd = process.cwd();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-sbox-'));
    process.chdir(tmp);
});

after(() => {
    process.chdir(prevCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
    if (prevEnv === undefined)
        delete process.env.WORK_SECRET_KEY;
    else
        process.env.WORK_SECRET_KEY = prevEnv;
});

beforeEach(() => { delete process.env.WORK_SECRET_KEY; });

describe('secret-box', () => {
    it('туда-обратно: формат v2, шифртекст не содержит открытых данных, узнаваем isSealed', async () => {
        const value = { token: 'S3CR3T-TOKEN', base_url: 'https://api.example.com' };
        const box = await seal(value, ctx);
        assert.equal(box.v, 2);
        assert.equal(box.alg, 'aes-256-gcm');
        assert.equal(Buffer.from(box.iv, 'base64').length, 12);
        assert.equal(Buffer.from(box.tag, 'base64').length, 16);
        assert.ok(isSealed(box));
        assert.ok(!JSON.stringify(box).includes('S3CR3T'));
        assert.ok(!Buffer.from(box.data, 'base64').toString('utf-8').includes('S3CR3T'));
        assert.deepEqual((await open(box, ctx)).value, value);
        assert.equal(isSealed({ type: 'token', token: 'x' }), false);
        assert.equal(isSealed(null), false);
    });

    it('каждое шифрование — новый iv (одинаковые данные дают разный шифртекст)', async () => {
        const a = await seal({ x: 1 }, ctx);
        const b = await seal({ x: 1 }, ctx);
        assert.notEqual(a.iv, b.iv);
        assert.notEqual(a.data, b.data);
    });

    it('подмена данных/тега/iv и чужой владелец (AAD) или назначение — отказ SECRET_CORRUPT', async () => {
        const box = await seal({ token: 'T' }, ctx);
        const flip = s => { const b = Buffer.from(s, 'base64'); b[0] ^= 1; return b.toString('base64'); };
        for (const bad of [{ ...box, data: flip(box.data) }, { ...box, tag: flip(box.tag) }, { ...box, iv: flip(box.iv) }])
            await assert.rejects(open(bad, ctx), { code: 'SECRET_CORRUPT' });
        await assert.rejects(open(box, { ...ctx, aad: 'U2/crm' }), { code: 'SECRET_CORRUPT' });
        await assert.rejects(open(box, { ...ctx, aad: 'U1/other' }), { code: 'SECRET_CORRUPT' });
        await assert.rejects(open(box, { ...ctx, info: 'work-other' }), { code: 'SECRET_KEY_MISMATCH' });
        await assert.rejects(open({ type: 'token' }, ctx), { code: 'SECRET_CORRUPT' });
    });

    it('укороченный тег не принимается', async () => {
        const box = await seal({ token: 'T' }, ctx);
        const short = { ...box, tag: Buffer.from(box.tag, 'base64').subarray(0, 4).toString('base64') };
        await assert.rejects(open(short, ctx), { code: 'SECRET_CORRUPT' });
    });

    it('без WORK_SECRET_KEY ключ производный от node-key.json (файл создаётся, ключ стабилен)', async () => {
        const box = await seal({ a: 1 }, ctx);
        assert.ok(fs.existsSync(path.join(tmp, '#system', 'node-key.json')), 'node-key.json не создан');
        const again = await seal({ a: 1 }, ctx);
        assert.equal(again.kid, box.kid);
    });

    it('WORK_SECRET_KEY: другой ключ шифрования; hex и base64 равнозначны; неверная длина — понятная ошибка', async () => {
        const noEnv = await seal({ a: 1 }, ctx);
        const raw = crypto.randomBytes(32);
        process.env.WORK_SECRET_KEY = raw.toString('hex');
        const viaHex = await seal({ a: 1 }, ctx);
        assert.notEqual(viaHex.kid, noEnv.kid);
        process.env.WORK_SECRET_KEY = raw.toString('base64');
        assert.equal((await seal({ a: 1 }, ctx)).kid, viaHex.kid);
        assert.deepEqual((await open(viaHex, ctx)).value, { a: 1 });
        process.env.WORK_SECRET_KEY = 'слишком-короткий';
        await assert.rejects(seal({ a: 1 }, ctx), /WORK_SECRET_KEY: нужно 32 байта/);
    });

    it('ключ добавили позже: запись под node-key читается и помечается rekey; запись под env — нет', async () => {
        const old = await seal({ token: 'T' }, ctx);
        process.env.WORK_SECRET_KEY = randomKey();
        const res = await open(old, ctx);
        assert.deepEqual(res.value, { token: 'T' });
        assert.equal(res.rekey, true);
        const fresh = await seal({ token: 'T' }, ctx);
        assert.equal((await open(fresh, ctx)).rekey, false);
        assert.notEqual(fresh.kid, old.kid);
    });

    it('ключ env сменили или убрали: запись под прежним env — SECRET_KEY_MISMATCH с понятным текстом', async () => {
        process.env.WORK_SECRET_KEY = randomKey();
        const box = await seal({ token: 'T' }, ctx);
        process.env.WORK_SECRET_KEY = randomKey();
        await assert.rejects(open(box, ctx), err => err.code === 'SECRET_KEY_MISMATCH' && /ключ шифрования изменился/.test(err.message));
        delete process.env.WORK_SECRET_KEY;
        await assert.rejects(open(box, ctx), { code: 'SECRET_KEY_MISMATCH' });
    });
});
