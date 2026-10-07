/**
 * Этап 3: браузер через CDP, секреты, обмен файлами с деревом — на фейковом dockerode.
 */
import '../sources/reactor.js';
import { it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { $server } from '../sources/server/server.js';
import { createEnv } from '../sources/modules/agent/index.js';
import { decide } from '../sources/modules/agent/permissions.js';
import { loadSandboxConfig } from '../sources/modules/sandbox/config.js';
import { setDockerForTests, resetDockerForTests } from '../sources/modules/sandbox/driver.js';
import {
    ensureComputer, resetRegistryForTests, cdp, ensureChromium,
} from '../sources/modules/sandbox/manager.js';
import { browserTools, listSecrets } from '../sources/modules/agent/tools/browser.js';
import { sandboxTools } from '../sources/modules/agent/tools/sandbox.js';
import { fakeDocker } from './helpers/fake-docker.js';

let tmp, root, previous;
function write(p, data) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); }
function ctx(uid = 'user9', extra = {}) {
    return { session: { uid }, host: { mode: 'auto', allowed: new Set() }, signal: new AbortController().signal, ...extra };
}

before(async () => {
    previous = process.cwd();
    const tempRoot = path.join(process.env.TEMP || os.tmpdir(), 'opencode');
    await fsp.mkdir(tempRoot, { recursive: true });
    tmp = await fsp.mkdtemp(path.join(tempRoot, 'browser-test-'));
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

it('браузер: open/snapshot/click/type/select/nav по фейку; cdp-ошибки понятные', async () => {
    setDockerForTests(fakeDocker());
    const t = name => browserTools.find(t => t.name === name);
    const open = await t('browser_open').run({ url: 'https://example.com' }, ctx());
    assert.match(open, /\[1\] button "Go"/);
    assert.match(open, /example\.com/);
    await assert.rejects(t('browser_open').run({ url: 'ftp://x' }, ctx()), /только http/);
    const snap = await t('browser_snapshot').run({}, ctx());
    assert.match(snap, /\[1\] link "More"/);
    assert.match(await t('browser_click').run({ ref: 1 }, ctx()), /клик \[1\]/);
    assert.match(await t('browser_type').run({ ref: 2, text: 'hi' }, ctx()), /ввод/);
    assert.match(await t('browser_select').run({ ref: 3, value: 'a' }, ctx()), /выбрано/);
    assert.match(await t('browser_nav').run({ action: 'back' }, ctx()), /Example/);

    const docker = fakeDocker();
    const pc = await ensureComputer(docker, 'user9', 'main', loadSandboxConfig());
    assert.equal(await ensureChromium(docker, pc.id, { timeoutSec: 5 }), false);
    await assert.rejects(cdp(docker, pc.id, 'bogus', {}), /nope/);
    resetRegistryForTests();
});

it('fill_secret: первый раз вопрос, потом разрешено; значение нигде не светится', async () => {
    setDockerForTests(fakeDocker());
    write(path.join(root, 'USERS', 'user9', '$user', '#secret', 'browser', 'gh.json'), JSON.stringify({ value: 's3cr3t-value' }));
    assert.deepEqual(listSecrets('user9'), ['gh']);
    assert.deepEqual(listSecrets('nobody'), []);
    const fill = browserTools.find(t => t.name === 'browser_fill_secret');
    const c = ctx('user9');
    const p1 = await fill.permission({ ref: 1, secret: 'gh' }, c);
    assert.equal(p1.verdict, 'ask');
    const res = await fill.run({ ref: 1, secret: 'gh' }, c);
    assert.match(res, /«gh» введён/);
    assert.ok(!res.includes('s3cr3t'));
    const p2 = await fill.permission({ ref: 1, secret: 'gh' }, c);
    assert.equal(p2.verdict, 'allow');
    await assert.rejects(fill.run({ ref: 1, secret: 'nope' }, c), /нет секрета/);
    resetRegistryForTests();
});

it('import/export: roundtrip между деревом и песочницей', async () => {
    setDockerForTests(fakeDocker());
    write(path.join(root, 'USERS', 'user9', '$user', 'class.js'), `export default { label: 'U9' }`);
    write(path.join(root, 'BOX', '$class', 'class.js'), `export default { label: 'Box', '#security': { USER: ['user9'] } }`);
    const imp = sandboxTools.find(t => t.name === 'sandbox_import');
    const exp = sandboxTools.find(t => t.name === 'sandbox_export');
    const c = ctx('user9');
    write(path.join(root, 'BOX', 'imp.bin'), Buffer.from('данные-импорт', 'utf-8'));
    WORK.reset();
    const r1 = await imp.run({ from: '/BOX/imp.bin', to: 'w/imp.bin' }, c);
    assert.match(r1, /записано/);
    await assert.rejects(imp.run({ from: '/BOX/нет-такого.bin', to: 'w/x' }, c), /не найдено/);
    const r2 = await exp.run({ from: 'w/imp.bin', to: '/BOX/exp.bin' }, c);
    assert.match(r2, /сохранено в WORK: (\S+)/);
    const savedPath = r2.match(/сохранено в WORK: (\S+)/)[1];
    const { getItem } = await import('../sources/modules/agent/tools/work.js');
    const back = await getItem(savedPath, c);
    const loaded = await (Array.isArray(back) ? back[0] : back).load({ session: c.session });
    assert.equal(Buffer.isBuffer(loaded) ? loaded.toString('utf-8') : String(loaded), 'данные-импорт');
    resetRegistryForTests();
});

it('видимость и разрешения: browser_* всем, план запрещает, export в систему спрашивает', async () => {
    setDockerForTests(fakeDocker());
    const env = await createEnv({ place: WORK, session: { uid: 'user' } });
    const names = (await env.makeTools()).map(t => t.name);
    for (const n of ['browser_open', 'browser_snapshot', 'browser_click', 'browser_type', 'browser_select', 'browser_nav', 'browser_secrets', 'browser_fill_secret', 'sandbox_import', 'sandbox_export'])
        assert.ok(names.includes(n), n);
    const open = browserTools.find(t => t.name === 'browser_open');
    const fill = browserTools.find(t => t.name === 'browser_fill_secret');
    const exp = sandboxTools.find(t => t.name === 'sandbox_export');
    const auto = { mode: 'auto', allowed: new Set() };
    assert.equal((await decide(open, { url: 'https://x' }, { host: auto })).verdict, 'allow');
    assert.equal((await decide(open, { url: 'https://x' }, { host: { mode: 'plan' } })).verdict, 'deny');
    assert.equal((await decide(fill, { ref: 1, secret: 'gh' }, { host: auto, session: { uid: 'user' } })).verdict, 'ask');
    assert.equal((await decide(exp, { from: 'a', to: '/USERS/user/work/f' }, { host: auto })).verdict, 'allow');
    const ask = await decide(exp, { from: 'a', to: '/$server/x' }, { host: auto });
    assert.equal(ask.verdict, 'ask');
    resetDockerForTests();
});

it('computer_status all: админ видит чужие, пользователь — нет', async () => {
    const docker = fakeDocker();
    setDockerForTests(docker);
    await ensureComputer(docker, 'other1', 'main', loadSandboxConfig());
    const status = sandboxTools.find(t => t.name === 'computer_status');
    const all = await status.run({ all: true }, ctx('admin'));
    assert.match(all, /other1/);
    await assert.rejects(status.run({ all: true }, ctx('user')), /администратор/);
    resetRegistryForTests();
});
