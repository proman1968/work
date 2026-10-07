/**
 * Песочницы (sources/modules/sandbox + tools/sandbox): конфиг, пути, изоляция,
 * жизненный цикл и инструменты — на фейковом клиенте dockerode.
 * Живой Docker не нужен; интеграция — scripts/sandbox-check.mjs.
 */
import '../sources/reactor.js';
import { it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { $server } from '../sources/server/server.js';
import { fakeDocker } from './helpers/fake-docker.js';
import { createEnv } from '../sources/modules/agent/index.js';
import { decide } from '../sources/modules/agent/permissions.js';
import { loadSandboxConfig } from '../sources/modules/sandbox/config.js';
import { setDockerForTests, resetDockerForTests } from '../sources/modules/sandbox/driver.js';
import { sandboxTools, sandboxAvailable } from '../sources/modules/agent/tools/sandbox.js';
import {
    ownerOf, computerName, slugOwner, containerName, assertSandboxPath, buildCreateOptions,
    ensureComputer, findComputer, listComputers, execCommand, readText, writeText, listDir,
    setNetwork, statusOf, destroyComputer, sweepIdle, resetRegistryForTests,
} from '../sources/modules/sandbox/manager.js';

let tmp, root, previous;
function write(p, data) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); }

before(async () => {
    previous = process.cwd();
    const tempRoot = path.join(process.env.TEMP || os.tmpdir(), 'opencode');
    await fsp.mkdir(tempRoot, { recursive: true });
    tmp = await fsp.mkdtemp(path.join(tempRoot, 'sandbox-test-'));
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

it('конфиг: умолчания, слияние, белый список', async () => {
    const d = loadSandboxConfig();
    assert.equal(d.image, 'work-computer:latest');
    assert.ok(d.images.includes('node:22-slim') && d.images.includes('python:3.12-slim'));
    assert.equal(d.limits.memoryMb, 1024);
    write(path.join(root, '#system/sandbox.json'), JSON.stringify({ image: 'node:22-slim', limits: { memoryMb: 512 }, network: { egressName: 'egress' } }));
    const m = loadSandboxConfig();
    assert.equal(m.image, 'node:22-slim');
    assert.equal(m.limits.memoryMb, 512);
    assert.equal(m.limits.cpus, 1);
    assert.equal(m.network.egressName, 'egress');
    assert.equal(m.maxPerUser, 2);
    fs.unlinkSync(path.join(root, '#system/sandbox.json'));
});

it('пути и имена: escape наружу запрещён', async () => {
    assert.equal(assertSandboxPath('a/b.txt'), '/workspace/a/b.txt');
    assert.equal(assertSandboxPath('/workspace/x'), '/workspace/x');
    assert.equal(assertSandboxPath('.'), '/workspace');
    assert.throws(() => assertSandboxPath('../../etc/passwd'), /вне рабочей папки/);
    assert.throws(() => assertSandboxPath('/etc/hosts'), /вне рабочей папки/);
    assert.throws(() => assertSandboxPath(''), /нужен путь/);
    assert.equal(computerName(), 'main');
    assert.throws(() => computerName('../x'), /недопустимое имя/);
    assert.equal(ownerOf({ session: { uid: 'u1' } }), 'u1');
    assert.equal(ownerOf({}), 'shared');
    assert.match(containerName('u1', 'main'), /^work-pc-u1-[a-z0-9]+-main$/);
    assert.equal(slugOwner('u1'), slugOwner('u1'));
});

it('создание: изоляция по умолчанию', async () => {
    const cfg = loadSandboxConfig();
    const { name, volume, options } = buildCreateOptions('user1', 'main', cfg);
    assert.match(name, /^work-pc-/);
    assert.ok(volume.endsWith('-data'));
    assert.equal(options.HostConfig.NetworkMode, cfg.network?.sandboxName || 'work-sandbox');
    assert.deepEqual(options.HostConfig.CapDrop, ['ALL']);
    assert.ok(options.HostConfig.SecurityOpt.includes('no-new-privileges:true'));
    assert.equal(options.HostConfig.Memory, 1024 * 1024 * 1024);
    assert.equal(options.HostConfig.NanoCpus, 1e9);
    assert.equal(options.HostConfig.Binds[0], volume + ':/workspace');
    assert.equal(options.Labels['work.sandbox'], '1');
    assert.deepEqual(options.Cmd, ['sleep', 'infinity']);
});

it('ensure/exec/read/write/ls по фейку; повторное ensure том переиспользует', async () => {
    const docker = fakeDocker();
    const cfg = loadSandboxConfig();
    const pc = await ensureComputer(docker, 'user1', 'main', cfg);
    assert.equal(pc.created, true);
    assert.equal(pc.state, 'running');
    const again = await ensureComputer(docker, 'user1', 'main', cfg);
    assert.equal(again.created, false);
    assert.equal(again.id, pc.id);
    const r = await execCommand(docker, pc.id, 'echo hello', { timeoutSec: 10, maxBytes: 1000 });
    assert.equal(r.code, 0);
    assert.match(r.stdout, /hello/);
    assert.equal(r.timedOut, false);
    const bad = await execCommand(docker, pc.id, 'exit 3', { timeoutSec: 10 });
    assert.equal(bad.code, 3);
    const to = await execCommand(docker, pc.id, 'hang', { timeoutSec: 10 });
    assert.equal(to.code, 124);
    assert.equal(to.timedOut, true);
    await writeText(docker, pc.id, '/workspace/notes/a.txt', 'привет', cfg);
    assert.equal(await readText(docker, pc.id, '/workspace/notes/a.txt', cfg), 'привет');
    assert.match(await listDir(docker, pc.id, '/workspace/notes', cfg), /a\.txt/);
    await assert.rejects(readText(docker, pc.id, '/workspace/notes/nope.txt', cfg), /нет файла/);
    await assert.rejects(writeText(docker, pc.id, '/workspace/big.txt', 'x'.repeat(cfg.maxWriteBytes + 1), cfg), /слишком больш/);
    // удаление и пересоздание: том удалён вместе с контейнером
    await destroyComputer(docker, pc.id);
    assert.equal(await findComputer(docker, 'user1', 'main'), null);
    assert.equal(docker.volumes.has([...docker.volumes][0]), false); // том удалён
    const recreated = await ensureComputer(docker, 'user1', 'main', cfg);
    assert.equal(recreated.created, true); // новый контейнер и том с нуля
    resetRegistryForTests();
});

it('квоты maxPerUser и maxRunning', async () => {
    const docker = fakeDocker();
    const one = { ...loadSandboxConfig(), maxPerUser: 1 };
    await ensureComputer(docker, 'user1', 'a', one);
    await assert.rejects(ensureComputer(docker, 'user1', 'b', one), /maxPerUser/);
    const small = { ...loadSandboxConfig(), maxRunning: 1 };
    await assert.rejects(ensureComputer(docker, 'user2', 'a', small), /общий лимит/);
    resetRegistryForTests();
});

it('сеть: вкл/выкл идемпотентно, статус показывает сети', async () => {
    const docker = fakeDocker();
    const cfg = loadSandboxConfig();
    const pc = await ensureComputer(docker, 'user1', 'main', cfg);
    assert.deepEqual(await setNetwork(docker, pc.id, true, cfg), { network: true, name: 'work-egress' });
    assert.deepEqual(await setNetwork(docker, pc.id, true, cfg), { network: true, name: 'work-egress' }); // уже подключена — ок
    let st = await statusOf(docker, pc.id);
    assert.ok(st.running && st.networks.includes('work-egress'));
    await setNetwork(docker, pc.id, false, cfg);
    await setNetwork(docker, pc.id, false, cfg); // уже отключена — ок
    st = await statusOf(docker, pc.id);
    assert.deepEqual(st.networks, ['work-sandbox']); // снова изолирован во внутренней сети
    const list = await listComputers(docker, 'user1');
    assert.equal(list.length, 1);
    assert.equal(list[0].owner, 'user1');
    assert.equal(await sweepIdle(docker, cfg), 0); // свежие — не трогаем
    resetRegistryForTests();
});

it('инструменты: видны всем при Docker, скрыты без него', async () => {
    setDockerForTests(fakeDocker());
    assert.equal(await sandboxAvailable(), true);
    const env = await createEnv({ place: WORK, session: { uid: 'user' } });
    const names = (await env.makeTools()).map(t => t.name);
    for (const n of ['computer_status', 'computer_network', 'computer_destroy', 'sandbox_exec', 'sandbox_read', 'sandbox_write', 'sandbox_ls'])
        assert.ok(names.includes(n), n);
    assert.ok(!(await env.makeTools()).some(t => t.system)); // не админ — системных нет, песочница есть
    assert.ok((await env.makeTools({ meta: { tools: 'sandbox_*' } })).every(t => t.name.startsWith('sandbox_')));
    const sub = await env.makeTools({ meta: { tools: '*' } });
    assert.ok(sub.some(t => t.name === 'sandbox_exec')); // субагенты наследуют
    const ctx = { session: { uid: 'user' }, host: { mode: 'auto', allowed: new Set() }, signal: new AbortController().signal };
    const exec = sandboxTools.find(t => t.name === 'sandbox_exec');
    const out = await exec.run({ command: 'echo ok' }, ctx);
    assert.match(out, /код выхода: 0/);
    assert.match(out, /ok/);
    const sys = await env.makeSystem();
    assert.match(sys, /Персональный компьютер/);
    setDockerForTests(null); // «Docker недоступен» (без reset — он снял бы подмену и пошёл в настоящий Docker)
    assert.equal(await sandboxAvailable(), false);
    const env2 = await createEnv({ place: WORK, session: { uid: 'user' } });
    assert.ok(!(await env2.makeTools()).some(t => t.name.startsWith('sandbox_') || t.name.startsWith('computer_')));
});

it('разрешения: exec без вопросов в auto, запрет в plan; сеть — всегда вопрос', async () => {
    setDockerForTests(fakeDocker());
    const exec = sandboxTools.find(t => t.name === 'sandbox_exec');
    const net = sandboxTools.find(t => t.name === 'computer_network');
    const host = { mode: 'auto', allowed: new Set() };
    assert.equal((await decide(exec, { command: 'echo 1' }, { host })).verdict, 'allow');
    assert.equal((await decide(exec, { command: 'echo 1' }, { host: { mode: 'plan' } })).verdict, 'deny');
    assert.equal((await decide(net, { on: true }, { host })).verdict, 'ask');
    assert.equal((await decide(net, { on: false }, { host })).verdict, 'allow');
    resetDockerForTests();
});

it('сеть: TTL авто-выключение', async () => {
    setDockerForTests(fakeDocker());
    const docker = fakeDocker();
    const cfg = loadSandboxConfig();
    const pc = await ensureComputer(docker, 'user1', 'main', cfg);
    await setNetwork(docker, pc.id, true, { ...cfg, network: { ...cfg.network, ttlMin: 0.001 } });
    // через 200 мс TTL истёк (0.001 мин = 60 мс)
    await new Promise(r => setTimeout(r, 200));
    const { sweepNetworkTTL } = await import('../sources/modules/sandbox/manager.js');
    const n = await sweepNetworkTTL(docker, { ...cfg, network: { ...cfg.network, ttlMin: 0.001 } });
    assert.equal(n, 1);
    // проверяем, что сеть обратно в sandbox
    const st = await statusOf(docker, pc.id);
    assert.ok(st.networks.includes('work-sandbox'));
    // повторный sweep = 0
    assert.equal(await sweepNetworkTTL(docker, { ...cfg, network: { ...cfg.network, ttlMin: 0.001 } }), 0);
    resetRegistryForTests();
});

it('destroyComputer: удаляет контейнер и том', async () => {
    setDockerForTests(fakeDocker());
    const docker = fakeDocker();
    const cfg = loadSandboxConfig();
    const pc = await ensureComputer(docker, 'user1', 'main', cfg);
    const vol = pc.id + '-data'; // fake-docker создаёт том с таким именем
    const r = await destroyComputer(docker, pc.id);
    assert.match(r, /удалён/);
    assert.match(r, /тоже/);
    // фейк удаляет том — проверяем через inspect
    const insp = await docker.getContainer(pc.id).inspect().catch(() => null);
    assert.equal(insp, null);
    resetRegistryForTests();
});
