/**
 * Пул stdio MCP-серверов: процесс на конфиг (command+args+env) живёт между вызовами,
 * initialize — один раз; простой IDLE_MS или смерть процесса — закрыть, следующий вызов поднимет заново.
 * Вызовы к одному серверу идут по одному каналу параллельно (JSON-RPC id), таймауты — на запрос.
 * Модуль-синглтон (слои дерева грузятся data:-модулями и пересоздаются — состояние держим здесь).
 */
import { spawn } from 'node:child_process';

export const IDLE_MS = 5 * 60_000;
export const START_TIMEOUT = 20_000;
export const CALL_TIMEOUT = 60_000;

const POOL = new Map();

function keyOf(cfg) {
    return JSON.stringify([cfg.command, cfg.args || [], cfg.env || {}, cfg.cwd || '']);
}

function channel(child) {
    let seq = 1;
    const pending = new Map();
    let buf = '';
    let stderr = '';
    child.stdout.on('data', chunk => {
        buf += String(chunk);
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i).trim();
            buf = buf.slice(i + 1);
            if (!line)
                continue;
            let msg;
            try {
                msg = JSON.parse(line);
            }
            catch {
                continue; // мусор сервера — не протокол
            }
            if (msg.id != null && pending.has(msg.id) && !msg.method) {
                const { resolve, reject } = pending.get(msg.id);
                pending.delete(msg.id);
                if (msg.error)
                    reject(new Error(msg.error.message || JSON.stringify(msg.error)));
                else
                    resolve(msg.result);
            }
            else if (msg.id != null && msg.method) {
                // запрос сервера (roots/sampling) — честный отказ
                write({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'not supported by work-mcp' } });
            }
        }
    });
    child.stderr.on('data', chunk => {
        stderr = (stderr + String(chunk)).slice(-2000);
    });
    const failAll = e => {
        for (const { reject } of pending.values())
            reject(e);
        pending.clear();
    };
    child.on('error', failAll);
    child.on('exit', code => failAll(new Error('процесс MCP завершён (код ' + code + '); stderr: ' + (stderr.trim().slice(-300) || '—'))));
    function write(obj) {
        child.stdin.write(JSON.stringify(obj) + '\n');
    }
    return {
        get stderr() { return stderr; },
        notify(method, params) {
            try {
                write({ jsonrpc: '2.0', method, params: params || {} });
            }
            catch { /* некому слушать */ }
        },
        request(method, params, timeout = CALL_TIMEOUT) {
            return new Promise((resolve, reject) => {
                const id = seq++;
                const timer = setTimeout(() => {
                    pending.delete(id);
                    reject(new Error('таймаут ' + timeout + 'мс; stderr: ' + (stderr.trim().slice(-300) || '—')));
                }, timeout);
                pending.set(id, {
                    resolve: v => { clearTimeout(timer); resolve(v); },
                    reject: e => { clearTimeout(timer); reject(e); },
                });
                try {
                    write({ jsonrpc: '2.0', id, method, params: params || {} });
                }
                catch (e) {
                    pending.delete(id);
                    clearTimeout(timer);
                    reject(e);
                }
            });
        },
    };
}

function start(key, cfg) {
    let command = String(cfg.command);
    if (process.platform === 'win32' && /^(npx|npm|pnpm|yarn)$/i.test(command))
        command += '.cmd';
    const child = spawn(command, (cfg.args || []).map(String), {
        env: { ...process.env, ...(cfg.env || {}) },
        cwd: cfg.cwd || undefined,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: process.platform === 'win32' && /\.cmd$/i.test(command),
        windowsHide: true,
    });
    const rpc = channel(child);
    const entry = { key, child, rpc, calls: 0, timer: null, ready: null, dead: false };
    const drop = () => {
        entry.dead = true;
        clearTimeout(entry.timer);
        if (POOL.get(key) === entry)
            POOL.delete(key);
    };
    child.on('exit', drop);
    child.on('error', drop);
    entry.ready = rpc.request('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'work-mcp', version: '2.0.0' },
    }, START_TIMEOUT).then(info => {
        rpc.notify('notifications/initialized');
        entry.info = info;
        return info;
    });
    entry.ready.catch(() => close(entry));
    POOL.set(key, entry);
    return entry;
}

function close(entry) {
    entry.dead = true;
    clearTimeout(entry.timer);
    if (POOL.get(entry.key) === entry)
        POOL.delete(entry.key);
    try {
        entry.child.stdin.end();
    }
    catch { /* закрыт */ }
    try {
        entry.child.kill();
    }
    catch { /* мёртв */ }
}

function touch(entry) {
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
        if (!entry.calls)
            close(entry);
        else
            touch(entry);
    }, IDLE_MS);
    entry.timer.unref?.();
}

/**
 * JSON-RPC вызов stdio-сервера из пула.
 * @param {{command:string,args?:string[],env?:object,cwd?:string}} cfg
 * @returns {Promise<any>} result (бросает при ошибке)
 */
export async function rpc(cfg, method, params, timeout = CALL_TIMEOUT) {
    const key = keyOf(cfg);
    let entry = POOL.get(key);
    if (!entry || entry.dead)
        entry = start(key, cfg);
    entry.calls++;
    try {
        await entry.ready;
        return await entry.rpc.request(method, params, timeout);
    }
    finally {
        entry.calls--;
        if (!entry.dead)
            touch(entry);
    }
}

/** Сколько процессов живо (диагностика/тесты). */
export function size() {
    return POOL.size;
}

/** Закрыть все процессы (остановка сервера, тесты). */
export function closeAll() {
    for (const entry of [...POOL.values()])
        close(entry);
}

/** pid процесса для конфига (тесты). */
export function pidOf(cfg) {
    return POOL.get(keyOf(cfg))?.child?.pid;
}

for (const sig of ['exit', 'SIGINT', 'SIGTERM'])
    process.once(sig, () => {
        closeAll();
        if (sig !== 'exit')
            process.exit(0);
    });
