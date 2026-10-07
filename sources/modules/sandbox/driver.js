/**
 * Подключение к Docker (dockerode грузится лениво — сервер стартует и без Docker).
 * Кэш доступности: ping не чаще раза в 30 секунд.
 */
import { loadSandboxConfig } from './config.js';

let cached = null;
let avail = { at: 0, ok: false, error: 'не проверялось' };
let testClient = null;
let hasTestClient = false;

/** Для тестов: подменить клиент (null — «Docker недоступен»). */
export function setDockerForTests(client) {
    testClient = client;
    hasTestClient = true;
    avail = { at: 0, ok: false, error: 'не проверялось' };
}

export function resetDockerForTests() {
    testClient = null;
    hasTestClient = false;
    cached = null;
    avail = { at: 0, ok: false, error: 'не проверялось' };
}

function dockerOptions() {
    const cfg = loadSandboxConfig().docker || {};
    if (cfg.socketPath)
        return { socketPath: cfg.socketPath };
    if (cfg.host)
        return { host: cfg.host, port: cfg.port || 2376 };
    if (process.platform === 'win32')
        return { socketPath: '//./pipe/docker_engine' };
    return { socketPath: '/var/run/docker.sock' };
}

/** Клиент dockerode (или тестовый). Бросает, если Docker недоступен. */
export async function getDocker() {
    if (hasTestClient) {
        if (!testClient)
            throw new Error('Docker недоступен (тестовая подмена)');
        return testClient;
    }
    if (cached)
        return cached;
    let Docker;
    try {
        Docker = (await import('dockerode')).default;
    }
    catch (e) {
        throw new Error('пакет dockerode не установлен: ' + e.message);
    }
    try {
        cached = new Docker(dockerOptions());
        await cached.ping();
    }
    catch (e) {
        cached = null;
        throw new Error('Docker недоступен (' + dockerWhere() + '): ' + shortError(e)
            + '. Поставьте Docker Desktop с WSL2 — инструкция в sources/modules/sandbox/readme.md');
    }
    return cached;
}

function dockerWhere() {
    const o = dockerOptions();
    return o.socketPath || (o.host + ':' + o.port);
}

function shortError(e) {
    const m = String(e?.message || e);
    if (/ENOENT|no such file/i.test(m))
        return 'сокет не найден — Docker не запущен';
    if (/EACCES|permission/i.test(m))
        return 'нет доступа к сокету Docker';
    if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND/i.test(m))
        return 'нет соединения с Docker';
    return m.slice(0, 200);
}

const AVAIL_TTL = 30_000;

/** Быстрая проверка доступности (кэш 30 с): { ok, error }. */
export async function dockerAvailable() {
    if (Date.now() - avail.at < AVAIL_TTL)
        return { ok: avail.ok, error: avail.error };
    try {
        const docker = await getDocker();
        const ping = docker.ping ? docker.ping() : Promise.resolve();
        await Promise.race([
            Promise.resolve(ping),
            new Promise((_, reject) => setTimeout(() => reject(new Error('таймаут ping')), 5000)),
        ]);
        avail = { at: Date.now(), ok: true, error: '' };
    }
    catch (e) {
        avail = { at: Date.now(), ok: false, error: String(e?.message || e).slice(0, 300) };
    }
    return { ok: avail.ok, error: avail.error };
}
