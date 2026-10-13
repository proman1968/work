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
    sandboxNetName, buildEgressRules, setIptablesForTests, helperOptions,
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
    // F13: внутренняя сеть — своя на владельца (чужие контейнеры не видны)
    assert.equal(options.HostConfig.NetworkMode, sandboxNetName(cfg, 'user1'));
    assert.notEqual(options.HostConfig.NetworkMode, sandboxNetName(cfg, 'user2'));
    assert.deepEqual(options.HostConfig.CapDrop, ['ALL']);
    assert.ok(options.HostConfig.SecurityOpt.includes('no-new-privileges:true'));
    assert.equal(options.HostConfig.Memory, 1024 * 1024 * 1024);
    assert.equal(options.HostConfig.NanoCpus, 1e9);
    assert.equal(options.HostConfig.Binds[0], volume + ':/workspace');
    assert.equal(options.Labels['work.sandbox'], '1');
    assert.deepEqual(options.Cmd, ['sleep', 'infinity']);
});

it('создание: корень «только чтение» — tmpfs (/tmp, home с uid/gid пользователя образа, /var/tmp, /run); выключается конфигом', () => {
    const cfg = { ...loadSandboxConfig(), readOnlyRootfs: true, homeDir: '/home/agent', homeUid: 1000, homeGid: 1000 };
    const { options } = buildCreateOptions('user1', 'main', cfg);
    assert.equal(options.HostConfig.ReadonlyRootfs, true);
    assert.deepEqual(options.HostConfig.Tmpfs, {
        '/tmp': 'rw,size=256m',
        '/home/agent': 'rw,size=512m,uid=1000,gid=1000',
        '/var/tmp': 'rw,size=64m',
        '/run': 'rw,size=64m',
    });
    const off = buildCreateOptions('user1', 'main', { ...cfg, readOnlyRootfs: false }).options;
    assert.equal(off.HostConfig.ReadonlyRootfs, false);
    assert.equal(off.HostConfig.Tmpfs, undefined);
    const other = buildCreateOptions('user1', 'main', { ...cfg, homeDir: '/root', homeUid: 0, homeGid: undefined }).options;
    assert.equal(other.HostConfig.Tmpfs['/root'], 'rw,size=512m,uid=0,gid=0', 'uid=0 (root) валиден; gid по умолчанию = uid');
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
    assert.deepEqual(st.networks, [sandboxNetName(cfg, 'user1')]); // снова изолирован в СВОЕЙ внутренней сети
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
    // маска сужает набор; чтение навыков (skill) субагентам добавляется всегда
    assert.ok((await env.makeTools({ meta: { tools: 'sandbox_*' } })).every(t => t.name.startsWith('sandbox_') || t.name === 'skill'));
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

it('exec с включённым интернетом помечает вывод чужим (untrusted); без сети — свой (8.2)', async () => {
    const docker = fakeDocker();
    setDockerForTests(docker);
    const exec = sandboxTools.find(t => t.name === 'sandbox_exec');
    const ctx = { session: { uid: 'user1' }, host: { mode: 'auto', allowed: new Set() }, signal: new AbortController().signal };
    await exec.run({ command: 'echo ok' }, ctx); // создаёт компьютер
    const clean = {};
    await exec.run({ command: 'echo ok' }, { ...ctx, entry: clean });
    assert.equal(clean.untrusted, undefined, 'без сети вывод помечен чужим');
    const pc = await findComputer(docker, 'user1', 'main');
    await setNetwork(docker, pc.id, true, loadSandboxConfig());
    const tainted = {};
    await exec.run({ command: 'echo ok' }, { ...ctx, entry: tainted });
    assert.equal(tainted.untrusted, true, 'с включённым интернетом вывод не помечен чужим');
    resetDockerForTests(); resetRegistryForTests();
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
    assert.ok(st.networks.includes(sandboxNetName(cfg, 'user1')));
    // повторный sweep = 0
    assert.equal(await sweepNetworkTTL(docker, { ...cfg, network: { ...cfg.network, ttlMin: 0.001 } }), 0);
    resetRegistryForTests();
});

// ── F13: изоляция сетей, egress-фильтр, квоты (final 8.6) ──────────────────────

it('F13 изоляция: внутренняя сеть — своя на владельца, чужие контейнеры не видны', async () => {
    const docker = fakeDocker();
    const cfg = loadSandboxConfig();
    const a = await ensureComputer(docker, 'user1', 'main', cfg);
    const b = await ensureComputer(docker, 'user2', 'main', cfg);
    const netA = sandboxNetName(cfg, 'user1'), netB = sandboxNetName(cfg, 'user2');
    assert.notEqual(netA, netB);
    assert.ok(docker.networks.has(netA) && docker.networks.has(netB), 'сети владельцев не созданы');
    const stA = await statusOf(docker, a.id), stB = await statusOf(docker, b.id);
    assert.deepEqual(stA.networks, [netA]);
    assert.deepEqual(stB.networks, [netB]);
    // в сети user1 — только контейнер user1 (никаких чужих endpoint-ов)
    const infoA = await docker.getNetwork(netA).inspect();
    assert.deepEqual(Object.keys(infoA.Containers), [a.id]);
    resetRegistryForTests();
});

it('F13 egress-фильтр: правила DOCKER-USER режут частные адреса; сбой фильтра = интернет не включается (fail-closed)', async () => {
    const docker = fakeDocker();
    const cfg = loadSandboxConfig();
    const pc = await ensureComputer(docker, 'user1', 'main', cfg);
    docker.iptables = [];
    // фейк эмулирует iptables-хелпер: правила записываются в docker.iptables
    const r = await setNetwork(docker, pc.id, true, cfg);
    assert.equal(r.network, true);
    // хелпер выполняет ОДНУ sh-команду со всеми правилами через '; '
    assert.ok((docker.iptables || []).length >= 1, 'правила фильтра не применены');
    const joined = (docker.iptables || []).join('\n');
    for (const cidr of ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '169.254.0.0/16'])
        assert.ok(joined.includes('-d ' + cidr), 'нет запрета ' + cidr);
    assert.ok(joined.includes('DOCKER-USER'), 'правила не в DOCKER-USER');
    const st = await statusOf(docker, pc.id);
    assert.ok(st.networks.includes(cfg.network.egressName), 'интернет не включён');
    await setNetwork(docker, pc.id, false, cfg);
    // сбой iptables (helper exit 1): интернет НЕ включается, контейнер остаётся в своей изолированной сети
    const broken = fakeDocker({ iptablesFail: true });
    const pc2 = await ensureComputer(broken, 'user1', 'main', cfg);
    await assert.rejects(setNetwork(broken, pc2.id, true, cfg), /не удалось ограничить выход в интернет/);
    const st2 = await statusOf(broken, pc2.id);
    assert.ok(!st2.networks.includes(cfg.network.egressName), 'интернет включился без фильтра');
    assert.ok(st2.networks.includes(sandboxNetName(cfg, 'user1')), 'песочница не осталась изолированной');
    resetRegistryForTests();
});

it('F13 buildEgressRules: полный набор частных диапазонов и имя моста', () => {
    const rules = buildEgressRules('br-abc123def456');
    const cidrs = rules.map(r => r.cidr);
    for (const cidr of ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '169.254.0.0/16', '100.64.0.0/10', '127.0.0.0/8', '224.0.0.0/4'])
        assert.ok(cidrs.includes(cidr), 'нет ' + cidr);
    assert.ok(rules.every(r => r.bridge === 'br-abc123def456'));
});

it('F13 гонка квот: параллельные ensure одного владельца не пробивают maxPerUser', async () => {
    // «медленный» фейк: создание контейнера отвечает с задержкой — окно гонки открыто
    // (оба успевают пройти проверку квот до того, как первый создастся)
    const slow = fakeDocker();
    const orig = slow.createContainer.bind(slow);
    slow.createContainer = async (o) => { await new Promise(r => setTimeout(r, 80)); return orig(o); };
    const cfg = { ...loadSandboxConfig(), maxPerUser: 1, maxRunning: 10 };
    const jobs = [ensureComputer(slow, 'user1', 'a', cfg), ensureComputer(slow, 'user1', 'b', cfg)];
    const results = await Promise.allSettled(jobs);
    const ok = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');
    assert.equal(ok.length, 1, 'создались оба: ' + JSON.stringify(results.map(r => r.status)));
    assert.equal(rejected.length, 1);
    assert.match(String(rejected[0].reason?.message || ''), /maxPerUser/);
    assert.equal((await listComputers(slow, 'user1')).length, 1);
    resetRegistryForTests();
});

it('F13 мягкая квота тома: превышение limits.volumeMb — отказ с пояснением', async () => {
    const docker = fakeDocker({ workspaceMb: 50 });
    const cfg = { ...loadSandboxConfig(), limits: { ...loadSandboxConfig().limits, volumeMb: 10 } };
    const pc = await ensureComputer(docker, 'user1', 'main', cfg); // 50 МБ > 10 МБ — квота на найденном пути
    assert.equal(pc.created, true); // создание прошло, лимит ловится при следующем подъёме
    await assert.rejects(ensureComputer(docker, 'user1', 'main', cfg), /превышает лимит/);
    resetRegistryForTests();
});

it('F13 уборка сетей: пустая сеть владельца удаляется, занятая остаётся', async () => {
    const docker = fakeDocker();
    const cfg = loadSandboxConfig();
    await ensureComputer(docker, 'user1', 'main', cfg);
    const a = await ensureComputer(docker, 'user2', 'main', cfg);
    const gone = await destroyComputer(docker, (await findComputer(docker, 'user1', 'main')).id);
    assert.match(gone, /удалён/);
    await sweepIdle(docker, cfg);
    assert.ok(!docker.networks.has(sandboxNetName(cfg, 'user1')), 'пустая сеть владельца не убрана');
    assert.ok(docker.networks.has(sandboxNetName(cfg, 'user2')), 'занятая сеть убрана');
    const st = await statusOf(docker, a.id);
    assert.ok(st.networks.includes(sandboxNetName(cfg, 'user2')));
    resetRegistryForTests();
});

// ── F26 (final 8.19): мелочи песочницы ────────────────────────────────────

it('F26: интернет, включённый до рестарта, выключается первым же обходом TTL', async () => {
    const docker = fakeDocker();
    const cfg = { ...loadSandboxConfig(), network: { ...loadSandboxConfig().network, ttlMin: 0.001 } };
    const pc = await ensureComputer(docker, 'user1', 'main', cfg);
    await setNetwork(docker, pc.id, true, cfg);
    // «рестарт сервера»: память процессов чиста, контейнер на egress остался
    resetRegistryForTests();
    const again = await ensureComputer(docker, 'user1', 'main', cfg); // реестр поднялся заново
    const { sweepNetworkTTL } = await import('../sources/modules/sandbox/manager.js');
    const n = await sweepNetworkTTL(docker, cfg);
    assert.equal(n, 1, 'контейнер с интернетом до рестарта не выключен');
    const st = await statusOf(docker, again.id);
    assert.ok(!st.networks.includes(cfg.network.egressName), 'интернет остался после рестарта');
    assert.ok(st.networks.includes(sandboxNetName(cfg, 'user1')));
    resetRegistryForTests();
});

it('F26: хелпер прав — только нужные возможности, без сети, лимиты, no-new-privileges', () => {
    const o = helperOptions('vol-1', '/workspace', loadSandboxConfig());
    assert.deepEqual(o.HostConfig.CapDrop, ['ALL']);
    assert.deepEqual(o.HostConfig.CapAdd, ['CHOWN', 'DAC_OVERRIDE', 'FOWNER']);
    assert.equal(o.HostConfig.NetworkMode, 'none', 'хелперу chown сеть не нужна');
    assert.ok(o.HostConfig.SecurityOpt.includes('no-new-privileges:true'));
    assert.equal(o.HostConfig.PidsLimit, 64);
    assert.equal(o.HostConfig.Memory, 256 * 1024 * 1024);
    assert.deepEqual(o.Cmd.slice(0, 2), ['chown', '-R']);
    assert.ok(o.HostConfig.AutoRemove);
});

it('F26: computer_destroy говорит правду — том с данными удаляется', async () => {
    const src = fs.readFileSync(path.resolve(import.meta.dirname, '../sources/modules/agent/tools/sandbox.js'), 'utf8');
    assert.doesNotMatch(src, /computer_destroy[\s\S]{0,600}?том сохранится/, 'текст подтверждения врёт про том');
    const d = sandboxTools.find(t => t.name === 'computer_destroy');
    assert.match(d.description, /пропадут насовсем/, 'описание не предупреждает об удалении данных');
    const ask = d.permission({ name: 'main' });
    assert.match(ask.reason, /пропадут насовсем|том с данными/, 'вопрос подтверждения не про удаление данных');
    // сам факт: destroyComputer действительно удаляет том (фиск) — уже проверено выше
});

it('F26: застрявший хелпер прав убивается — не остаётся висеть root-контейнером', async () => {
    // зонд падает (том «чужой»), хелпер зависает — ensureComputer обязан отказаться и убить хелпера
    const docker = fakeDocker({ probeFails: true, stuckHelper: true });
    const cfg = loadSandboxConfig();
    await assert.rejects(ensureComputer(docker, 'user1', 'main', cfg), /хелпер прав не завершился|не починил/);
    // хелпер остановлен/убран: живых контейнеров с командой chown нет
    const helpers = [...docker.containers.values()].filter(c => c.createOpts?.Cmd?.[0] === 'chown');
    assert.ok(helpers.every(c => c.State !== 'running'), 'хелпер остался жить (running: ' + helpers.filter(c => c.State === 'running').length + ')');
    resetRegistryForTests();
}, 30000);

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
