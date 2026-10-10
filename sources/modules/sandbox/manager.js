/**
 * Менеджер персональных компьютеров (Docker-контейнеров).
 * Все операции принимают клиент dockerode первым аргументом — удобно подменять в тестах.
 * Изоляция: сеть none, CapDrop ALL, no-new-privileges, лимиты CPU/RAM/PID, только белый список образов.
 */
import path from 'node:path';
import { loadSandboxConfig } from './config.js';
import { demux, demuxBytes } from './stream.js';
import { clip } from '../agent/util.js';

export const LABEL = 'work.sandbox';
const NAME_RE = /^[\w.-]{1,32}$/;

/** Реестр: owner/name → { id, lastUsed }. */
const registry = new Map();
/** Кто управляет экраном: id → { by:'agent'|'human', at }. Нет записи — агент. */
const control = new Map();
/** Сериализация операций дисплея: id → цепочка промисов. */
const displayLocks = new Map();
export function resetRegistryForTests() {
    registry.clear();
    control.clear();
    displayLocks.clear();
    netEnabled.clear();
}
function touch(owner, name, id) {
    registry.set(owner + '/' + name, { id, lastUsed: Date.now() });
}

/** Владелец из контекста инструмента. */
export function ownerOf(ctx) {
    return String(ctx?.session?.uid || ctx?.session?.$user?.id || 'shared');
}

function fnv(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(36);
}

/** Безопасный фрагмент имён Docker из произвольного uid. */
export function slugOwner(owner) {
    const base = String(owner || 'shared').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'user';
    return base + '-' + fnv(String(owner));
}

/** Имя компьютера (дефолт main). */
export function computerName(raw) {
    const name = String(raw || 'main').trim() || 'main';
    if (!NAME_RE.test(name))
        throw new Error('недопустимое имя компьютера (буквы, цифры, . - _, до 32): ' + name.slice(0, 60));
    return name;
}

export function containerName(owner, name) {
    return 'work-pc-' + slugOwner(owner) + '-' + name;
}

export function volumeName(owner, name) {
    return containerName(owner, name) + '-data';
}

/**
 * Путь внутри песочницы → абсолютный в пределах workdir. Относительный — от workdir.
 * Бросает при выходе за пределы (../, абсолютный мимо workdir, пустой).
 */
export function assertSandboxPath(p, workdir = '/workspace') {
    const wd = '/' + String(workdir || '/workspace').replace(/^\/+|\/+$/g, '');
    let s = String(p ?? '').trim().replace(/\\/g, '/');
    if (!s)
        throw new Error('нужен путь в песочнице (относительно ' + wd + ')');
    if (s.includes('\0'))
        throw new Error('недопустимый путь');
    s = s.startsWith('/') ? path.posix.normalize(s) : path.posix.normalize(wd + '/' + s);
    if (s !== wd && !s.startsWith(wd + '/'))
        throw new Error('путь вне рабочей папки ' + wd + ': ' + String(p).slice(0, 120));
    return s;
}

/** Опции создания контейнера: изоляция по умолчанию. Чистая функция — покрыта тестами. */
export function buildCreateOptions(owner, name, cfg) {
    const cname = containerName(owner, name);
    const lim = cfg.limits || {};
    return {
        name: cname,
        volume: volumeName(owner, name),
        options: {
            name: cname,
            Image: cfg.image,
            Cmd: ['sleep', 'infinity'],
            WorkingDir: cfg.workdir || '/workspace',
            ...(cfg.user ? { User: cfg.user } : {}),
            Env: ['DEBIAN_FRONTEND=noninteractive', 'WORK_PC=1'],
            Labels: { [LABEL]: '1', 'work.owner': String(owner).slice(0, 128), 'work.name': name },
            HostConfig: {
                // Изолированная внутренняя сеть (без внешнего маршрута). Контейнер на NetworkMode:none
                // Docker вообще запрещает цеплять к сетям — поэтому изоляция через Internal:true,
                // а интернет — горячей заменой сети (setNetwork), а не подключением второй.
                NetworkMode: sandboxNetName(cfg),
                Memory: Math.max(64, Number(lim.memoryMb) || 1024) * 1024 * 1024,
                NanoCpus: Math.max(1, Math.round((Number(lim.cpus) || 1) * 1e9)),
                PidsLimit: Math.max(32, Number(lim.pids) || 256),
                CapDrop: ['ALL'],
                SecurityOpt: ['no-new-privileges:true'],
                ReadonlyRootfs: false,
                AutoRemove: false,
                Init: true,  // tini — собирает зомби-процессы
                Binds: [volumeName(owner, name) + ':' + (cfg.workdir || '/workspace')],
            },
        },
    };
}

/** Имя изолированной внутренней сети. */
export function sandboxNetName(cfg) {
    return cfg.network?.sandboxName || 'work-sandbox';
}

/** Изолированная сеть (Internal — без внешнего маршрута), создать при отсутствии. */
export async function ensureIsolatedNetwork(docker, cfg = loadSandboxConfig()) {
    const name = sandboxNetName(cfg);
    const nets = await docker.listNetworks({ filters: JSON.stringify({ name: [name] }) }).catch(() => []);
    if (!(nets || []).some(n => n.Name === name))
        await docker.createNetwork({ Name: name, Labels: { [LABEL]: '1' }, Internal: true, CheckDuplicate: true }).catch(e => { throw friendly(e); });
    return name;
}

/** Починить права на рабочей папке: том мог быть создан другим образом (root-владелец). */
export async function fixWorkspacePerms(docker, id, wd, owner, name, cfg = loadSandboxConfig()) {
    // Проверяем, что папка доступна для записи: попытка создать файл
    const probe = await execRaw(docker, id, {
        cmd: ['sh', '-c', 'mkdir -p "$1" && touch "$1/.probe_" && rm -f "$1/.probe_" && echo ok', 'sh', wd],
        timeoutSec: 15, maxBytes: 50,
    });
    if (String(probe.stdout).trim() === 'ok')
        return; // уже работает

    // Том создан другим образом и принадлежит root.
    // Контейнер с CapDrop ALL не может chown — нужен временный контейнер-хелпер с root.
    const vol = volumeName(owner, name);
    const helperOpts = {
        Image: cfg.image, Cmd: ['chown', '-R', '1000:1000', wd],
        HostConfig: { Binds: [vol + ':' + wd], AutoRemove: true },
    };
    let helper;
    try {
        helper = await docker.createContainer(helperOpts);
    }
    catch (e) {
        // Если и хелпер не может — пробуем без bind (Docker Desktop может иначе маппить)
        throw new Error('права на ' + wd + ': том создан другим образом — удалите том вручную и пересоздайте компьютер ('
            + String(e?.message || e).slice(0, 200) + ')');
    }
    await helper.start();
    // Ждём завершения хелпера (chown быстрый) — через docker API, т.к. createContainer может вернуть что угодно
    const helperId = helper.id || helper.Id;
    for (let i = 0; i < 30; i++) {
        const insp = await docker.getContainer(helperId).inspect().catch(() => null);
        if (insp && insp.State && !insp.State.Running) {
            if (insp.State.ExitCode !== 0) {
                throw new Error('хелпер не починил права на ' + wd + ' (exit ' + insp.State.ExitCode + ')');
            }
            break;
        }
        await new Promise(r => setTimeout(r, 500));
    }
    // Повторная проверка
    const check = await execRaw(docker, id, {
        cmd: ['sh', '-c', 'mkdir -p "$1" && touch "$1/.probe_" && rm -f "$1/.probe_" && echo ok', 'sh', wd],
        timeoutSec: 15, maxBytes: 50,
    });
    if (String(check.stdout).trim() !== 'ok')
        throw new Error('права на ' + wd + ' не починились после хелпера');
}

function labelFilters(owner, name) {
    const labels = [LABEL + '=1'];
    if (owner)
        labels.push('work.owner=' + owner);
    if (name)
        labels.push('work.name=' + name);
    return JSON.stringify({ label: labels });
}

async function drain(stream) {
    if (!stream || typeof stream.on !== 'function')
        return;
    await new Promise(resolve => {
        stream.on('data', () => {});
        stream.on('end', resolve);
        stream.on('error', resolve);
        stream.resume?.();
    });
}

async function pullImage(docker, image) {
    const images = await docker.listImages().catch(() => []);
    if ((images || []).some(im => (im.RepoTags || []).includes(image)))
        return false;
    const stream = await docker.pull(image);
    await drain(stream);
    return true;
}

/** Найти контейнер по меткам (без создания). */
export async function findComputer(docker, owner, name) {
    const list = await docker.listContainers({ all: true, filters: labelFilters(owner, name) });
    const hit = (list || [])[0];
    if (!hit)
        return null;
    touch(owner, name, hit.Id);
    return { id: hit.Id, names: hit.Names, image: hit.Image, state: hit.State, status: hit.Status };
}

/** Компьютеры пользователя (или все при owner=null). */
export async function listComputers(docker, owner = null) {
    const list = await docker.listContainers({ all: true, filters: labelFilters(owner || undefined) });
    return (list || []).map(c => ({
        id: String(c.Id).slice(0, 12),
        names: (c.Names || []).map(n => n.replace(/^\//, '')),
        image: c.Image,
        state: c.State,
        status: c.Status,
        owner: c.Labels?.['work.owner'] || '',
        name: c.Labels?.['work.name'] || '',
    }));
}

/**
 * Компьютер пользователя: найти, поднять остановленный или создать. Проверяет квоты.
 * @returns {{ id, name, state, created:boolean, image:string }}
 */
export async function ensureComputer(docker, owner, name, cfg = loadSandboxConfig()) {
    name = computerName(name);
    if (!cfg.images.includes(cfg.image))
        throw new Error('образ по умолчанию вне белого списка (#system/sandbox.json images): ' + cfg.image);
    const found = await findComputer(docker, owner, name).catch(e => { throw friendly(e); });
    if (found) {
        const c = docker.getContainer(found.id);
        const insp = await c.inspect().catch(() => null);
        if (insp && !insp.State?.Running) {
            await c.start().catch(e => { throw friendly(e); });
            return { id: found.id, name, state: 'running', created: false, image: cfg.image, started: true };
        }
        if (insp)
            return { id: found.id, name, state: 'running', created: false, image: cfg.image };
        registry.delete(owner + '/' + name);
    }
    // квоты
    const all = await docker.listContainers({ all: true, filters: labelFilters() }).catch(e => { throw friendly(e); });
    const running = (all || []).filter(c => c.State === 'running');
    if (running.length >= (Number(cfg.maxRunning) || 4))
        throw new Error('достигнут общий лимит запущенных компьютеров (' + cfg.maxRunning + ') — остановите чужой или попросите админа');
    const mine = (all || []).filter(c => c.Labels?.['work.owner'] === owner);
    if (mine.length >= (Number(cfg.maxPerUser) || 2))
        throw new Error('у вас уже ' + mine.length + ' компьютер(а,ов) (лимит maxPerUser:' + cfg.maxPerUser + ')');
    // образ, том, сети, создание
    try {
        await pullImage(docker, cfg.image);
    }
    catch (e) {
        throw new Error('образ «' + cfg.image + '» недоступен: ' + String(e?.message || e).slice(0, 200)
            + (cfg.image.startsWith('work-') ? ' — соберите локально: docker build -t ' + cfg.image + ' sources/modules/sandbox/images/work-computer' : ' — проверьте сеть Docker'));
    }
    await ensureIsolatedNetwork(docker, cfg);
    const { volume, options } = buildCreateOptions(owner, name, cfg);
    await docker.createVolume({ Name: volume, Labels: { [LABEL]: '1' } }).catch(e => {
        if (!/exists|conflict|409/i.test(String(e?.message || e)))
            throw friendly(e);
    });
    let created;
    try {
        created = await docker.createContainer(options);
    }
    catch (e) {
        throw friendly(e);
    }
    await created.start().catch(e => { throw friendly(e); });
    touch(owner, name, created.id);
    // рабочая папка: том может быть от другого образа и принадлежать root
    const wd = cfg.workdir || '/workspace';
    await fixWorkspacePerms(docker, created.id, wd, owner, name, cfg);
    // графический образ: дождаться дисплея и VNC, иначе первые скриншоты чёрные, а просмотр пуст
    if ((cfg.graphical || []).includes(cfg.image)) {
        const waitSec = Number(cfg.displayWaitSec) || 30;
        await waitDisplay(docker, created.id, { timeoutSec: waitSec }).catch(() => {});
        await waitVnc(docker, created.id, { timeoutSec: waitSec }).catch(() => {});
    }
    sweepIdle(docker, cfg).catch(() => {});
    return { id: created.id, name, state: 'running', created: true, image: cfg.image };
}

/**
 * Низкоуровневый exec (массив argv). Тайм-аут — через sleep-сторожок снаружи + destroy потока.
 */
export async function execRaw(docker, id, { cmd, workdir = '/workspace', timeoutSec = 120, maxBytes = 200_000, signal, env } = {}) {
    signal?.throwIfAborted();
    const container = docker.getContainer(id);
    const execOpts = { AttachStdout: true, AttachStderr: true, Cmd: cmd, WorkingDir: workdir };
    if (Array.isArray(env) && env.length)
        execOpts.Env = env;
    const exec = await container.exec(execOpts).catch(e => { throw friendly(e); });
    const stream = await exec.start({ Detach: false, Tty: false }).catch(e => { throw friendly(e); });
    let timedOut = false;
    const timer = setTimeout(() => {
        timedOut = true;
        try { stream.destroy?.(); } catch { /* уже закрыт */ }
    }, Math.max(5, Number(timeoutSec) || 120) * 1000 + 15000);
    const onAbort = () => {
        timedOut = true;
        try { stream.destroy?.(); } catch { /* уже закрыт */ }
    };
    signal?.addEventListener?.('abort', onAbort, { once: true });
    try {
        const { stdout, stderr, truncated } = await demux(stream, maxBytes);
        const insp = await exec.inspect().catch(() => null);
        return {
            code: Number(insp?.ExitCode ?? 0),
            stdout, stderr, truncated,
            timedOut: timedOut || !!signal?.aborted,
            aborted: !!signal?.aborted,
        };
    }
    finally {
        clearTimeout(timer);
        signal?.removeEventListener?.('abort', onAbort);
    }
}

/** Команда оболочки: sh -c + `timeout` внутри (код 124 → timedOut). */
export async function execCommand(docker, id, command, o = {}) {
    const sec = Math.min(600, Math.max(1, Number(o.timeoutSec) || 120));
    const r = await execRaw(docker, id, {
        cmd: ['timeout', '-s', 'KILL', String(sec), 'sh', '-c', String(command)],
        workdir: o.workdir, timeoutSec: sec, maxBytes: o.maxBytes, signal: o.signal,
    });
    return { ...r, timedOut: r.timedOut || r.code === 124 };
}

/** Текст файла (stat → проверка размера → base64). */
export async function readText(docker, id, spath, cfg = loadSandboxConfig()) {
    return (await readBytes(docker, id, spath, cfg)).toString('utf-8');
}

/** Байты файла (stat → проверка размера → base64). */
export async function readBytes(docker, id, spath, cfg = loadSandboxConfig()) {
    const stat = await execRaw(docker, id, { cmd: ['sh', '-c', 'stat -c %s -- "$1"', 'sh', spath], timeoutSec: 30, maxBytes: 100 });
    if (stat.code !== 0)
        throw new Error('нет файла: ' + spath + (stat.stderr.trim() ? ' (' + stat.stderr.trim().slice(0, 200) + ')' : ''));
    const size = Number(stat.stdout.trim());
    if (!Number.isFinite(size) || size > (Number(cfg.maxReadBytes) || 1_000_000))
        throw new Error('файл слишком большой (' + size + ' байт, лимит ' + cfg.maxReadBytes + ')');
    if (size === 0)
        return Buffer.alloc(0);
    const r = await execRaw(docker, id, { cmd: ['sh', '-c', 'base64 -- "$1"', 'sh', spath], timeoutSec: 60, maxBytes: size * 2 + 1024 });
    if (r.code !== 0)
        throw new Error('не прочитался: ' + spath);
    return Buffer.from(r.stdout.replace(/\s+/g, ''), 'base64');
}

/** Запись текста (base64 через аргумент; лимит maxWriteBytes). */
export async function writeText(docker, id, spath, content, cfg = loadSandboxConfig()) {
    const raw = Buffer.from(String(content ?? ''), 'utf-8');
    return writeBytes(docker, id, spath, raw, cfg);
}

/** Запись байтов (base64 через аргумент; лимит maxWriteBytes). */
export async function writeBytes(docker, id, spath, data, cfg = loadSandboxConfig()) {
    const raw = Buffer.isBuffer(data) ? data : Buffer.from(data ?? '');
    if (raw.length > (Number(cfg.maxWriteBytes) || 200_000))
        throw new Error('данные слишком большие (' + raw.length + ' байт, лимит ' + cfg.maxWriteBytes + ')');
    const b64 = raw.toString('base64');
    const r = await execRaw(docker, id, {
        cmd: ['sh', '-c', 'mkdir -p -- "$(dirname -- "$2")" && printf %s "$1" | base64 -d > "$2" && wc -c < "$2"', 'sh', b64, spath],
        timeoutSec: 60, maxBytes: 4000,
    });
    if (r.code !== 0)
        throw new Error('не записался ' + spath + (r.stderr.trim() ? ': ' + r.stderr.trim().slice(0, 300) : ''));
    return 'записано ' + r.stdout.trim() + ' байт в ' + spath;
}

/** Содержимое папки. */
export async function listDir(docker, id, spath) {
    const r = await execRaw(docker, id, { cmd: ['ls', '-la', '--', spath], timeoutSec: 30, maxBytes: 20000 });
    if (r.code !== 0)
        throw new Error('нет папки: ' + spath);
    return r.stdout.trim() || '(пусто)';
}

/** Исходящая сеть: горячая замена изолированной сети на egress и обратно.
 * Контейнер всегда ровно в одной сети (none-режим запрещает даже подключение —
 * поэтому изоляция через Internal-сеть, а не NetworkMode:none). */
const netEnabled = new Map(); // id → timestamp when enabled

export async function setNetwork(docker, id, on, cfg = loadSandboxConfig()) {
    const egress = cfg.network?.egressName || 'work-egress';
    const nets = await docker.listNetworks({ filters: JSON.stringify({ name: [egress] }) }).catch(() => []);
    if (!(nets || []).some(n => n.Name === egress))
        await docker.createNetwork({ Name: egress, Labels: { [LABEL]: '1' }, CheckDuplicate: true }).catch(e => { throw friendly(e); });
    const iso = await ensureIsolatedNetwork(docker, cfg);
    const swap = async (connect, disconnect) => {
        await docker.getNetwork(connect).connect({ Container: id }).catch(e => {
            if (!/already connected|already exists/i.test(String(e?.message || e)))
                throw friendly(e);
        });
        await docker.getNetwork(disconnect).disconnect({ Container: id, Force: true }).catch(e => {
            if (!/not connected|no such endpoint|not found/i.test(String(e?.message || e)))
                throw friendly(e);
        });
    };
    if (on) {
        await swap(egress, iso);
        netEnabled.set(id, Date.now());
    } else {
        netEnabled.delete(id);
        await swap(iso, egress);
    }
    return { network: !!on, name: egress };
}

/** Состояние компьютера: inspect + сети + время включения интернета. */
export async function statusOf(docker, id) {
    const insp = await docker.getContainer(id).inspect().catch(e => { throw friendly(e); });
    const nets = Object.keys(insp.NetworkSettings?.Networks || {});
    return {
        id: String(insp.Id).slice(0, 12),
        name: insp.Name?.replace(/^\//, ''),
        image: insp.Config?.Image,
        running: !!insp.State?.Running,
        status: insp.State?.Status,
        startedAt: insp.State?.StartedAt,
        networks: nets,
        mounts: (insp.Mounts || []).map(m => m.Destination + ' ← ' + (m.Name || m.Source)),
        memoryMb: Math.round((insp.HostConfig?.Memory || 0) / 1048576),
        netEnabledAt: netEnabled.has(id) ? netEnabled.get(id) : null,
    };
}

/** Выключить интернет у всех компьютеров, у которых истёк TTL. */
export async function sweepNetworkTTL(docker, cfg = loadSandboxConfig()) {
    const ttlMin = Number(cfg.network?.ttlMin);
    if (!ttlMin || ttlMin <= 0)
        return 0;
    const now = Date.now();
    const ttlMs = ttlMin * 60_000;
    let disabled = 0;
    for (const [id, ts] of netEnabled) {
        if (now - ts > ttlMs) {
            await setNetwork(docker, id, false, cfg).catch(() => {});
            disabled++;
        }
    }
    return disabled;
}

/** Удалить контейнер (том с данными сохраняется — пересоздание подхватит файлы). */
export async function destroyComputer(docker, id) {
    const c = docker.getContainer(id);
    const insp = await c.inspect().catch(() => null);
    // имя тома — из первого Mounts (единственный бинд — рабочая папка)
    const volName = (insp?.Mounts || [])[0]?.Name;
    await c.stop().catch(() => {});
    await c.remove().catch(e => { throw friendly(e); });
    if (volName)
        await docker.getVolume(volName).remove().catch(() => {}); // данные пропадут!
    for (const [k, v] of registry)
        if (v.id === id)
            registry.delete(k);
    netEnabled.delete(id);
    return 'компьютер удалён (данные в томе тоже, новый создастся с нуля)';
}

/** Остановить простаивающие компьютеры. */
export async function sweepIdle(docker, cfg = loadSandboxConfig()) {
    const idleMs = Math.max(5, Number(cfg.idleStopMin) || 30) * 60_000;
    const now = Date.now();
    const list = await docker.listContainers({ all: true, filters: labelFilters() }).catch(() => []);
    let stopped = 0;
    for (const c of list || []) {
        if (c.State !== 'running')
            continue;
        const owner = c.Labels?.['work.owner'], name = c.Labels?.['work.name'];
        const key = owner + '/' + name;
        if (!registry.has(key))
            touch(owner, name, c.Id);
        if (now - registry.get(key).lastUsed > idleMs) {
            await docker.getContainer(c.Id).stop().catch(() => {});
            stopped++;
        }
    }
    return stopped;
}

/** Отметить использование (после exec/файлов). */
export function touchComputer(owner, name, id) {
    touch(owner, name, id);
}

function friendly(e) {
    const m = String(e?.message || e);
    if (/No such container|no such container|404/i.test(m))
        return new Error('компьютер не найден (возможно, удалён вручную) — создайте заново');
    if (/quota|limit|quota exceeded/i.test(m))
        return new Error('Docker отклонил создание (квоты/место): ' + m.slice(0, 200));
    return new Error(m.slice(0, 300));
}

/** Результат exec → текст для модели. */
export function formatExec(r, limit = 20000) {
    const parts = [];
    if (r.timedOut)
        parts.push('[таймаут — процесс остановлен]');
    if (r.aborted)
        parts.push('[остановлено пользователем]');
    if (r.truncated)
        parts.push('[вывод усечён]');
    parts.push('код выхода: ' + r.code);
    if (r.stdout.trim())
        parts.push('stdout:\n' + clip(r.stdout.replace(/\s+$/, ''), limit));
    if (r.stderr.trim())
        parts.push('stderr:\n' + clip(r.stderr.replace(/\s+$/, ''), Math.floor(limit / 3)));
    return parts.join('\n');
}

// ── дисплей (этап 2: экран, мышь, клавиатура) ──────────────────────────────

export const DISPLAY = ':99';
export const SCREENSHOT_MAX = 5_000_000;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Выполнить операции дисплея строго по очереди (мышь/клавиатура общие). */
export function withDisplay(id, fn) {
    const prev = displayLocks.get(id) || Promise.resolve();
    const next = prev.catch(() => {}).then(fn);
    displayLocks.set(id, next.catch(() => {})); // цепочка живёт, ошибка уходит вызывающему
    return next;
}

/** Кто сейчас управляет экраном ('agent' по умолчанию). */
export function controlBy(id) {
    return control.get(id)?.by || 'agent';
}

/** Передать/вернуть управление экраном ('human' — человек смотрит и кликает сам). */
export function setControl(id, by) {
    if (by !== 'human')
        control.delete(id);
    else
        control.set(id, { by, at: Date.now() });
}

function assertAgentControl(id) {
    if (controlBy(id) === 'human')
        throw new Error('экраном сейчас управляет человек (кнопка «Компьютер» → «Взять управление») — действия недоступны, дождитесь возврата или попросите человека отпустить экран');
}

/**
 * Действие мыши/клавиатуры → argv для xdotool. Чистая функция.
 * Координаты — пиксели при 1280×800 (масштабируй пропорционально, если скриншот меньше).
 */
export function buildDisplayAction(a = {}) {
    const kind = String(a.action || '');
    const n = v => {
        const x = Math.round(Number(v));
        if (!Number.isFinite(x) || x < 0 || x > 4096)
            throw new Error('координата вне 0–4096: ' + String(v).slice(0, 20));
        return x;
    };
    const at = (x, y) => [n(x), n(y)];
    switch (kind) {
        case 'click': {
            const [x, y] = at(a.x, a.y);
            return { argv: ['xdotool', 'mousemove', String(x), String(y), 'click', a.button === 3 ? '3' : '1'], label: 'клик (' + x + ',' + y + ')' };
        }
        case 'double_click': {
            const [x, y] = at(a.x, a.y);
            return { argv: ['xdotool', 'mousemove', String(x), String(y), 'click', '--repeat', '2', '--delay', '120', '1'], label: 'двойной клик (' + x + ',' + y + ')' };
        }
        case 'right_click': {
            const [x, y] = at(a.x, a.y);
            return { argv: ['xdotool', 'mousemove', String(x), String(y), 'click', '3'], label: 'правый клик (' + x + ',' + y + ')' };
        }
        case 'drag': {
            const [x1, y1] = at(a.x1, a.y1);
            const [x2, y2] = at(a.x2, a.y2);
            return { argv: ['xdotool', 'mousemove', String(x1), String(y1), 'mousedown', '1', 'mousemove', String(x2), String(y2), 'mouseup', '1'], label: 'перетаскивание (' + x1 + ',' + y1 + ')→(' + x2 + ',' + y2 + ')' };
        }
        case 'move': {
            const [x, y] = at(a.x, a.y);
            return { argv: ['xdotool', 'mousemove', String(x), String(y)], label: 'навести (' + x + ',' + y + ')' };
        }
        case 'type': {
            const text = String(a.text ?? '');
            if (!text)
                throw new Error('нужен text');
            if (text.length > 2000)
                throw new Error('text слишком длинный (максимум 2000 символов за вызов)');
            return { argv: ['xdotool', 'type', '--delay', '12', '--', text], label: 'ввод «' + text.slice(0, 60) + (text.length > 60 ? '…' : '') + '»' };
        }
        case 'key': {
            const key = String(a.key || '').trim();
            if (!/^[A-Za-z0-9_+-]{1,40}$/.test(key))
                throw new Error('недопустимая клавиша (латиница, цифры, _+- до 40, например Return, Tab, ctrl+c): ' + key.slice(0, 60));
            return { argv: ['xdotool', 'key', '--clearmodifiers', key], label: 'клавиша ' + key };
        }
        case 'scroll': {
            const [x, y] = at(a.x ?? 640, a.y ?? 400);
            const dir = a.direction === 'up' ? '4' : '5';
            const amount = Math.min(10, Math.max(1, Math.round(Number(a.amount) || 3)));
            return { argv: ['xdotool', 'mousemove', String(x), String(y), 'click', '--repeat', String(amount), dir], label: 'прокрутка ' + (dir === '4' ? 'вверх' : 'вниз') + ' ×' + amount };
        }
        case 'wait': {
            const ms = Math.min(10000, Math.max(200, Math.round(Number(a.ms) || 1000)));
            return { argv: ['sh', '-c', 'sleep ' + (ms / 1000)], label: 'пауза ' + ms + ' мс' };
        }
        default:
            throw new Error('неизвестное действие (click, double_click, right_click, drag, move, type, key, scroll, wait): ' + kind.slice(0, 40));
    }
}

/** Выполнить действие дисплея (сериализовано, только когда экраном владеет агент). */
export async function execDisplayAction(docker, id, a, o = {}) {
    assertAgentControl(id);
    const { argv, label } = buildDisplayAction(a);
    return withDisplay(id, async () => {
        const r = await execRaw(docker, id, {
            cmd: argv, workdir: '/tmp', timeoutSec: 30, maxBytes: 4000,
            env: ['DISPLAY=' + (o.display || DISPLAY)], signal: o.signal,
        });
        if (r.code !== 0)
            throw new Error('действие не выполнено (' + label + ')' + (r.stderr.trim() ? ': ' + r.stderr.trim().slice(0, 300) : ''));
        return { label };
    });
}

/** Ждать готовности дисплея (Xvfb+WM): xdotool отвечает геометрией, затем ждём первое видимое окно. */
export async function waitDisplay(docker, id, { timeoutSec = 30, windowSec = 15, display = DISPLAY, signal } = {}) {
    const cmd = (c, bytes = 200) => execRaw(docker, id, {
        cmd: ['sh', '-c', c], workdir: '/tmp', timeoutSec: 10, maxBytes: bytes, env: ['DISPLAY=' + display], signal,
    }).catch(e => ({ code: 1, stderr: String(e?.message || e), stdout: '' }));
    const deadline = Date.now() + Math.max(5, timeoutSec) * 1000;
    let last = '', geometry = '';
    for (;;) {
        signal?.throwIfAborted();
        const r = await cmd('xdotool getdisplaygeometry');
        if (r.code === 0 && /\d+\s+\d+/.test(r.stdout)) {
            geometry = r.stdout.trim();
            break;
        }
        last = (r.stderr || r.stdout || '').trim().slice(0, 120);
        if (Date.now() >= deadline)
            throw new Error('дисплей не поднялся за ' + timeoutSec + ' с' + (last ? ': ' + last : ''));
        await new Promise(res => setTimeout(res, 1000));
    }
    // стартовые приложения (терминал) дорисовываются позже X — ждём первое окно, но не вечно
    const wdeadline = Date.now() + Math.max(0, windowSec) * 1000;
    for (;;) {
        const w = await cmd('xdotool search --onlyvisible --limit 1 .');
        if (w.code === 0)
            break;
        if (Date.now() >= wdeadline)
            break;
        await new Promise(res => setTimeout(res, 1000));
    }
    return geometry;
}

/** Ждать VNC-порт 5900 внутри (x11vnc стартует после X). */
export async function waitVnc(docker, id, { timeoutSec = 30, signal } = {}) {
    const deadline = Date.now() + Math.max(5, timeoutSec) * 1000;
    for (;;) {
        signal?.throwIfAborted();
        const r = await execRaw(docker, id, {
            cmd: ['python3', '-c', 'import socket;s=socket.create_connection(("127.0.0.1",5900),timeout=2);s.close();print("open")'],
            workdir: '/tmp', timeoutSec: 10, maxBytes: 200, signal,
        }).catch(() => ({ code: 1 }));
        if (r.code === 0)
            return true;
        if (Date.now() >= deadline)
            throw new Error('VNC-порт 5900 не открылся за ' + timeoutSec + ' с (x11vnc не стартовал?)');
        await new Promise(res => setTimeout(res, 1000));
    }
}

/**
 * Вызов помощника браузера в контейнере: python3 /opt/work/cdp.py <op> <json>.
 * @returns {any} result из {"ok":true,"result":…}
 */
export async function cdp(docker, id, op, params = {}, o = {}) {
    const r = await execRaw(docker, id, {
        cmd: ['python3', '/opt/work/cdp.py', String(op), JSON.stringify(params || {})],
        workdir: '/tmp', timeoutSec: Math.min(300, Math.max(10, Number(o.timeoutSec) || 90)),
        maxBytes: 100_000, env: o.env, signal: o.signal,
    });
    let parsed = null;
    try {
        parsed = JSON.parse(r.stdout.trim().split('\n').pop());
    }
    catch { /* не JSON */ }
    if (parsed && typeof parsed === 'object') {
        if (parsed.ok)
            return parsed.result;
        throw browserError(String(parsed.error || 'неизвестная ошибка браузера'));
    }
    if (/No such file|not found|cannot/i.test(r.stderr) || r.code === 127)
        throw new Error('у этого компьютера нет браузера (нет /opt/work/cdp.py): он создан из образа без графики. '
            + 'Не ставь Chromium вручную — удали компьютер (computer_destroy) и повтори: он пересоздастся из образа work-computer (файлы в /workspace сохранятся).');
    throw browserError('cdp ' + op + ': ' + (r.stderr.trim() || r.stdout.trim()).slice(0, 300));
}

function browserError(m) {
    if (/ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION|net::/i.test(m))
        return new Error('страница не открылась (сети нет?) — включите интернет через computer_network, он спросит человека. ' + m.slice(0, 200));
    if (/Chromium не отвечает/i.test(m))
        throw new Error(m + ' — попробуйте browser_open заново (Chromium стартует сам)');
    return new Error(m.slice(0, 400));
}

/** Chromium с отладочным портом: проверить, иначе запустить и дождаться. */
const chromiumStarts = new Map();
export async function ensureChromium(docker, id, { timeoutSec = 60, signal } = {}) {
    const prev = chromiumStarts.get(id);
    if (prev)
        return prev;
    const job = (async () => {
        try {
            await cdp(docker, id, 'version', {}, { timeoutSec: 15, signal });
            return false;
        }
        catch (e) {
            if (!/Chromium не отвечает|не отвечает на :9222/i.test(String(e?.message || e)))
                throw e;
        }
        // Профиль живёт в томе: после гибели контейнера остаётся Singleton-лок —
        // тома персональные (на компьютер), чужого живого Chromium там быть не может, чистим.
        // Если /workspace недоступна для записи (том от другого образа) — пробуем /home/agent.
        const wd = '/workspace';
        const profile = wd + '/.chromium';
        const launch = await execRaw(docker, id, {
            cmd: ['sh', '-c',
                'rm -f ' + profile + '/SingletonSocket ' + profile + '/SingletonLock ' + profile + '/SingletonCookie 2>/dev/null; '
                + 'mkdir -p ' + profile + ' 2>/dev/null && DISPLAY=:99 chromium --remote-debugging-port=9222 '
                + '--no-first-run --no-default-browser-check --disable-dev-shm-usage --no-sandbox '
                + '--user-data-dir=' + profile + ' about:blank >/tmp/chromium.log 2>&1 & echo LAUNCHED_PID=$! || '
                // fallback: профиль в /home/agent
                + '{ mkdir -p /home/agent/.chromium && DISPLAY=:99 chromium --remote-debugging-port=9222 '
                + '--no-first-run --no-default-browser-check --disable-dev-shm-usage --no-sandbox '
                + '--user-data-dir=/home/agent/.chromium about:blank >/tmp/chromium.log 2>&1 & echo LAUNCHED_PID=$!; }'],
            workdir: '/tmp', timeoutSec: 15, maxBytes: 500, signal,
        });
        if (launch.code !== 0) {
            // Реальная причина из лога
            const logTail = (launch.stderr || launch.stdout || '').trim().slice(-300);
            throw new Error('Chromium не запустился: ' + logTail.slice(0, 300));
        }
        const deadline = Date.now() + Math.max(10, timeoutSec) * 1000;
        for (;;) {
            signal?.throwIfAborted();
            try {
                await cdp(docker, id, 'version', {}, { timeoutSec: 10, signal });
                return true;
            }
            catch (e) {
                // Быстрая проверка: если процесс уже умер — сразу ошибка с логом
                const ps = await execRaw(docker, id, {
                    cmd: ['sh', '-c', 'pgrep -a chromium | head -1 || true'],
                    timeoutSec: 5, maxBytes: 200, signal,
                }).catch(() => ({ code: 1, stdout: '' }));
                if (!ps.stdout.trim() && Date.now() >= deadline - 10000) {
                    const log = await execRaw(docker, id, {
                        cmd: ['sh', '-c', 'tail -8 /tmp/chromium.log 2>/dev/null || true'],
                        timeoutSec: 10, maxBytes: 1000, signal,
                    });
                    const tail = (log.stdout || '').trim().slice(-300);
                    throw new Error('Chromium упал сразу: ' + tail.slice(0, 300));
                }
            }
            if (Date.now() >= deadline)
                throw new Error('Chromium не ответил за ' + timeoutSec + ' с — смотрите /tmp/chromium.log в песочнице');
            await new Promise(res => setTimeout(res, 2000));
        }
    })();
    chromiumStarts.set(id, job);
    try {
        return await job;
    }
    finally {
        if (chromiumStarts.get(id) === job)
            chromiumStarts.delete(id);
    }
}

/** Скриншот экрана → Buffer PNG (1280×800). Читать может и человек, и агент. */
export async function screenshotPng(docker, id, o = {}) {
    return withDisplay(id, async () => {
        o.signal?.throwIfAborted();
        const container = docker.getContainer(id);
        const exec = await container.exec({
            AttachStdout: true, AttachStderr: true,
            Env: ['DISPLAY=' + (o.display || DISPLAY)],
            Cmd: ['sh', '-c', 'scrot -o -'],
            WorkingDir: '/tmp',
        }).catch(e => { throw friendly(e); });
        const stream = await exec.start({ Detach: false, Tty: false }).catch(e => { throw friendly(e); });
        const timer = setTimeout(() => { try { stream.destroy?.(); } catch { /* уже закрыт */ } }, 30000);
        try {
            const { stdout, stderr } = await demuxBytes(stream, o.maxBytes || SCREENSHOT_MAX);
            if (!stdout.length || !stdout.subarray(0, 8).equals(PNG_MAGIC)) {
                const hint = stderr.trim().slice(0, 200);
                if (/not found|command not found|127/i.test(hint) || !stdout.length)
                    throw new Error('в образе нет графики (scrot): нужен образ work-computer (этап 2)' + (hint ? ' — ' + hint : ''));
                throw new Error('скриншот не получился: ' + (hint || 'не PNG'));
            }
            return stdout;
        }
        finally {
            clearTimeout(timer);
        }
    });
}
