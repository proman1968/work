/**
 * Этап 2: экран компьютера — действия (чистые), мьютекс, скриншоты в ленте/контексте,
 * инструменты computer_* — на фейковом dockerode. Живой Docker не нужен.
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
import {
    toMessages, normalizeShots, collectShots, stripOldShots, SHOTS_IN_CONTEXT,
} from '../sources/modules/agent/loop.js';
import { loadSandboxConfig } from '../sources/modules/sandbox/config.js';
import { setDockerForTests, resetDockerForTests } from '../sources/modules/sandbox/driver.js';
import {
    buildDisplayAction, withDisplay, controlBy, setControl, ensureComputer,
    execDisplayAction, screenshotPng, waitDisplay, waitVnc, resetRegistryForTests,
} from '../sources/modules/sandbox/manager.js';
import { computerTools } from '../sources/modules/agent/tools/computer.js';
import { fakeDocker, PNG_1X1 } from './helpers/fake-docker.js';

let tmp, root, previous;
function write(p, data) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); }

before(async () => {
    previous = process.cwd();
    const tempRoot = path.join(process.env.TEMP || os.tmpdir(), 'opencode');
    await fsp.mkdir(tempRoot, { recursive: true });
    tmp = await fsp.mkdtemp(path.join(tempRoot, 'computer-test-'));
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

function ctx(uid = 'user9') {
    return { session: { uid }, host: { mode: 'auto', allowed: new Set() }, signal: new AbortController().signal };
}

it('действия дисплея: argv и валидация', async () => {
    assert.deepEqual(buildDisplayAction({ action: 'click', x: 100, y: 200 }).argv,
        ['xdotool', 'mousemove', '100', '200', 'click', '1']);
    assert.ok(buildDisplayAction({ action: 'double_click', x: 1, y: 2 }).argv.includes('--repeat'));
    assert.equal(buildDisplayAction({ action: 'right_click', x: 1, y: 2 }).argv.at(-1), '3');
    assert.deepEqual(buildDisplayAction({ action: 'drag', x1: 1, y1: 2, x2: 3, y2: 4 }).argv,
        ['xdotool', 'mousemove', '1', '2', 'mousedown', '1', 'mousemove', '3', '4', 'mouseup', '1']);
    assert.ok(buildDisplayAction({ action: 'type', text: 'hi' }).argv.includes('hi'));
    assert.ok(buildDisplayAction({ action: 'key', key: 'ctrl+c' }).argv.includes('ctrl+c'));
    assert.ok(buildDisplayAction({ action: 'scroll', direction: 'up', amount: 2 }).argv.includes('4'));
    assert.ok(buildDisplayAction({ action: 'wait', ms: 500 }).argv.join(' ').includes('sleep'));
    assert.throws(() => buildDisplayAction({ action: 'click', x: -5, y: 1 }), /0–4096/);
    assert.throws(() => buildDisplayAction({ action: 'click', x: 5000, y: 1 }), /0–4096/);
    assert.throws(() => buildDisplayAction({ action: 'type', text: 'x'.repeat(2001) }), /2000/);
    assert.throws(() => buildDisplayAction({ action: 'key', key: 'a;b' }), /недопустимая клавиша/);
    assert.throws(() => buildDisplayAction({ action: 'nope' }), /неизвестное действие/);
});

it('мьютекс дисплея сериализует операции', async () => {
    const order = [];
    let release;
    const gate = new Promise(r => { release = r; });
    const p1 = withDisplay('d1', async () => { order.push(1); await gate; order.push(2); });
    const p2 = withDisplay('d1', async () => { order.push(3); });
    await new Promise(r => setTimeout(r, 20));
    assert.deepEqual(order, [1]); // вторая ждёт первую
    release();
    await Promise.all([p1, p2]);
    assert.deepEqual(order, [1, 2, 3]);
    resetRegistryForTests();
});

it('скриншот: PNG-байты; без графики — понятная ошибка; человек блокирует действия', async () => {
    const docker = fakeDocker();
    const cfg = loadSandboxConfig();
    const pc = await ensureComputer(docker, 'user9', 'main', cfg);
    assert.equal(controlBy(pc.id), 'agent');
    const png = await screenshotPng(docker, pc.id);
    assert.ok(png.equals(PNG_1X1));
    const r = await execDisplayAction(docker, pc.id, { action: 'click', x: 100, y: 200 });
    assert.match(r.label, /клик \(100,200\)/);
    assert.ok(docker.calls.some(c => c[0] === 'xdotool' && c.includes('100')));
    setControl(pc.id, 'human');
    assert.equal(controlBy(pc.id), 'human');
    await assert.rejects(execDisplayAction(docker, pc.id, { action: 'click', x: 1, y: 1 }), /управляет человек/);
    await screenshotPng(docker, pc.id); // читать можно и при человеке
    setControl(pc.id, 'agent');
    assert.equal(controlBy(pc.id), 'agent');
    resetRegistryForTests();

    const bare = fakeDocker({ noGraphics: true });
    const pc2 = await ensureComputer(bare, 'user9', 'g', cfg);
    await assert.rejects(screenshotPng(bare, pc2.id), /нет графики/);
    resetRegistryForTests();
});

it('ожидание дисплея и VNC: успех и тайм-аут', async () => {
    const docker = fakeDocker();
    const pc = await ensureComputer(docker, 'user9', 'main', loadSandboxConfig());
    assert.equal(await waitDisplay(docker, pc.id, { timeoutSec: 5 }), '1280 800');
    assert.equal(await waitVnc(docker, pc.id, { timeoutSec: 5 }), true);
    resetRegistryForTests();

    const bare = fakeDocker({ noDisplay: true });
    const pc2 = await ensureComputer(bare, 'user9', 'g', { ...loadSandboxConfig(), displayWaitSec: 5 });
    await assert.rejects(waitDisplay(bare, pc2.id, { timeoutSec: 5 }), /дисплей не поднялся/);
    await assert.rejects(waitVnc(bare, pc2.id, { timeoutSec: 5 }), /VNC-порт/);
    resetRegistryForTests();
});

it('инструменты computer_*: скриншот и действие возвращают картинки', async () => {
    setDockerForTests(fakeDocker());
    const shot = computerTools.find(t => t.name === 'computer_screenshot');
    const act = computerTools.find(t => t.name === 'computer_action');
    const sres = await shot.run({}, ctx());
    assert.equal(typeof sres.text, 'string');
    assert.equal(sres.images.length, 1);
    assert.ok(sres.images[0].png.equals(PNG_1X1));
    const ares = await act.run({ action: 'key', key: 'Return' }, ctx());
    assert.match(ares.text, /скриншот/i);
    assert.match(ares.images[0].label, /клавиша Return/);
    resetRegistryForTests();
});

it('handoff: вопрос человеку и ответ; без host.wait — честный фолбэк', async () => {
    setDockerForTests(fakeDocker());
    const handoff = computerTools.find(t => t.name === 'computer_handoff');
    const entry = {};
    const c = { ...ctx(), entry, turn: { id: 't1' }, host: { ...ctx().host, wait: async () => ({ content: 'сам войду' }), save: async () => {} } };
    const res = await handoff.run({ reason: 'капча' }, c);
    assert.equal(entry.status, 'running');
    assert.match(res.text, /Ответ человека: сам войду/);
    assert.equal(res.images.length, 1);
    const c2 = { ...ctx(), entry: {}, turn: { id: 't2' }, host: { mode: 'auto', allowed: new Set() } };
    assert.match(await handoff.run({ reason: 'капча' }, c2), /недоступен/);
    resetRegistryForTests();
});

it('цикл: normalize/collect/strip + toMessages; видимость и разрешения', async () => {
    assert.equal(SHOTS_IN_CONTEXT, 3);
    const good = normalizeShots([{ png: PNG_1X1, label: 'экран' }]);
    assert.equal(good.length, 1);
    assert.ok(good[0].url.startsWith('data:image/png;base64,'));
    assert.deepEqual(normalizeShots([{ png: Buffer.from('не png') }]), []);
    assert.deepEqual(normalizeShots([{ png: Buffer.alloc(4 * 1024 * 1024) }]), []);
    const four = normalizeShots([1, 2, 3, 4].map(i => ({ png: PNG_1X1, label: 's' + i })));
    assert.equal(four.length, 3);
    assert.equal(four[0].label, 's2');

    const items = [1, 2, 3, 4].map(i => ({
        id: 'a' + i, type: 'assistant', time: i, content: '',
        tools: [{ id: 'c' + i, name: 'computer_screenshot', args: {}, status: 'ok', result: 'shot', images: [{ url: 'data:image/png;base64,' + i, label: 's' + i }] }],
    }));
    assert.equal(collectShots(items).length, 3);
    assert.equal(collectShots(items)[0].label, 's2');
    stripOldShots(items);
    assert.ok(!items[0].tools[0].images && items[0].tools[0].shotDropped);
    assert.ok(items[3].tools[0].images);

    const msgs = toMessages('', items, new Map());
    const last = msgs[msgs.length - 1];
    assert.equal(last.role, 'user');
    assert.ok(Array.isArray(last.content));
    assert.equal(last.content.filter(p => p.type === 'image_url').length, 3);
    assert.match(last.content[0].text, /\[1\] s2/);
    const noVision = toMessages('', items, null);
    assert.ok(!noVision.some(m => Array.isArray(m.content) && m.content.some(p => p.type === 'image_url')));

    setDockerForTests(fakeDocker());
    const env = await createEnv({ place: WORK, session: { uid: 'user' } });
    const names = (await env.makeTools()).map(t => t.name);
    assert.ok(names.includes('computer_screenshot') && names.includes('computer_action') && names.includes('computer_handoff'));
    const shot = computerTools.find(t => t.name === 'computer_screenshot');
    const act = computerTools.find(t => t.name === 'computer_action');
    const hand = computerTools.find(t => t.name === 'computer_handoff');
    const host = { mode: 'auto', allowed: new Set() };
    assert.equal((await decide(shot, {}, { host })).verdict, 'allow');
    assert.equal((await decide(shot, {}, { host: { mode: 'plan' } })).verdict, 'allow'); // чтение
    assert.equal((await decide(act, { action: 'click', x: 1, y: 1 }, { host })).verdict, 'allow');
    assert.equal((await decide(act, { action: 'click', x: 1, y: 1 }, { host: { mode: 'plan' } })).verdict, 'deny');
    assert.equal((await decide(hand, { reason: 'x' }, { host: { mode: 'plan' } })).verdict, 'deny');
    resetDockerForTests();
});
