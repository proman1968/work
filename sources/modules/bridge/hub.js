/**
 * Серверный хаб и исполнитель команд агента-«моста» на компьютере пользователя (9.12):
 *   - Компьютер пользователя сам подключается к WORK по HTTP (/~bridge/*) с персональным токеном
 *     Bearer `wmcp.<uid>.<секрет>` (sources/modules/mcp/tokens.js) — входящие порты на ПК не нужны;
 *   - Строгая изоляция по владельцу (uid): задача пользователя U видит и вызывает только мост U;
 *   - Режим «только просмотр» (readOnly): при readOnly=true разрешены только status/windows/ls/read,
 *     любые изменяющие и активные команды (write, open_app, focus_window) жёстко отклоняются и на сервере,
 *     и на самом мосте;
 *   - Песочница файлов на ПК (assertBridgePath): доступ только внутри корневой папки моста (--root),
 *     запрет выхода через `..` и запрет чувствительных имён (.env, .ssh, id_rsa, credentials, secret…);
 *   - Запуск программ (open_app) — только из белого списка имён (allowedApps) через spawn(..., { shell: false }),
 *     никакого произвольного шелла;
 *   - Полный журнал каждого действия в аудите безопасности WORK (event: 'desktop_bridge') и кольцевом буфере моста.
 */
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { verifyToken } from '../mcp/tokens.js';
import { clientAllowed } from '../mcp/server.js';
import { audit } from '../../server/access/audit.js';

const BRIDGE_TTL_MS = 2 * 60_000;
const CMD_TIMEOUT_MS = 30_000;
const FILE_READ_MAX = 512 * 1024;
const FILE_WRITE_MAX = 1024 * 1024;
const HISTORY_MAX = 50;
const SENSITIVE_FILE = /(^|[\\/])(\.env(\..+)?|\.ssh|\.gnupg|\.aws|id_rsa|id_ed25519|.*credentials.*|.*secret.*|.*\.(pem|pfx|p12|key))$/i;
const APP_NAME_RE = /^[a-zA-Z0-9._-]{1,40}$/;

/** Изменяющие/активные операции моста (запрещены в режиме readOnly). */
export const WRITE_OPS = new Set(['write', 'open_app', 'focus_window']);
export const READ_OPS = new Set(['status', 'ls', 'read', 'windows']);

/** Активные мосты по uid пользователя: uid → BridgeSession. */
const bridges = new Map();

function recordLog(session, entry) {
    const item = { time: new Date().toISOString(), ...entry };
    session.history.push(item);
    if (session.history.length > HISTORY_MAX)
        session.history.shift();
    audit('desktop_bridge', { uid: session.uid, ...entry });
}

/**
 * Проверить путь файла внутри корневой папки моста на ПК пользователя.
 * Блокирует выход за пределы rootDir (`..`, чужой диск) и чувствительные файлы (.env, .ssh, ключи).
 */
export function assertBridgePath(rootDir, relPath) {
    if (!rootDir)
        throw new Error('bridge: не задана корневая папка моста (rootDir)');
    const base = fs.existsSync(rootDir) ? fs.realpathSync(rootDir) : path.resolve(rootDir);
    const raw = String(relPath ?? '.').trim() || '.';
    if (raw.includes('\0'))
        throw new Error('bridge: недопустимый путь');
    const resolved = path.resolve(base, raw);
    const rel = path.relative(base, resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel))
        throw new Error('bridge: выход за пределы разрешённой папки компьютера запрещён: ' + raw);
    // Ф.1: если файл или его родитель существует — проверяем realpathSync против обхода через символическую ссылку
    const checkReal = fs.existsSync(resolved) ? resolved : (fs.existsSync(path.dirname(resolved)) ? path.dirname(resolved) : null);
    if (checkReal) {
        const realTarget = fs.realpathSync(checkReal);
        const realRel = path.relative(base, realTarget);
        if (realRel.startsWith('..') || path.isAbsolute(realRel))
            throw new Error('bridge: символическая ссылка уводит за пределы разрешённой папки компьютера: ' + raw);
    }
    if (rel && SENSITIVE_FILE.test(rel))
        throw new Error('bridge: доступ к чувствительным файлам и ключам запрещён: ' + rel);
    return { base, resolved, rel: rel.replace(/\\/g, '/') || '.' };
}

/**
 * Выполнить операцию локально на стороне моста (используется и CLI-клиентом моста, и in-process мостом в тестах).
 * Повторно проверяет readOnly, белый список программ и границы папки rootDir.
 */
export async function executeLocalBridgeOp(cfg, cmd) {
    const op = String(cmd?.op || '');
    const readOnly = Boolean(cfg?.readOnly);
    if (readOnly && WRITE_OPS.has(op))
        throw new Error('bridge: компьютер в режиме «только просмотр» (readOnly) — операция «' + op + '» запрещена');

    const rootDir = path.resolve(cfg?.rootDir || process.cwd());

    if (op === 'status') {
        return {
            hostname: cfg?.hostname || os.hostname(),
            platform: cfg?.platform || process.platform,
            rootDir,
            readOnly,
            allowedApps: Array.isArray(cfg?.allowedApps) ? cfg.allowedApps : [],
        };
    }

    if (op === 'ls') {
        const { resolved, rel } = assertBridgePath(rootDir, cmd.path || '.');
        const entries = await fsp.readdir(resolved, { withFileTypes: true });
        const items = [];
        for (const e of entries.slice(0, 200)) {
            if (SENSITIVE_FILE.test(e.name))
                continue;
            items.push({ name: e.name, type: e.isDirectory() ? 'dir' : 'file' });
        }
        return { path: rel, items };
    }

    if (op === 'read') {
        const { resolved, rel } = assertBridgePath(rootDir, cmd.path);
        const st = await fsp.stat(resolved);
        if (!st.isFile())
            throw new Error('bridge: это не файл: ' + rel);
        if (st.size > FILE_READ_MAX)
            throw new Error('bridge: файл больше лимита (' + st.size + ' > ' + FILE_READ_MAX + ' байт)');
        const content = await fsp.readFile(resolved, 'utf-8');
        return { path: rel, size: st.size, content };
    }

    if (op === 'write') {
        const { resolved, rel } = assertBridgePath(rootDir, cmd.path);
        const text = String(cmd.content ?? '');
        if (Buffer.byteLength(text, 'utf-8') > FILE_WRITE_MAX)
            throw new Error('bridge: текст больше лимита 1 МБ');
        await fsp.mkdir(path.dirname(resolved), { recursive: true });
        await fsp.writeFile(resolved, text, 'utf-8');
        return { path: rel, bytes: Buffer.byteLength(text, 'utf-8'), written: true };
    }

    if (op === 'windows') {
        if (typeof cfg?.listWindows === 'function')
            return { windows: await cfg.listWindows() };
        return { windows: [{ id: '1', title: 'Рабочий стол (' + os.hostname() + ')', app: 'desktop' }] };
    }

    if (op === 'focus_window') {
        const title = String(cmd.title || '').trim();
        if (!title)
            throw new Error('bridge: укажи заголовок окна (title)');
        if (typeof cfg?.focusWindow === 'function')
            return await cfg.focusWindow(title);
        return { focused: title };
    }

    if (op === 'open_app') {
        const app = String(cmd.app || '').trim();
        if (!APP_NAME_RE.test(app))
            throw new Error('bridge: недопустимое имя программы «' + app + '»');
        const allowed = Array.isArray(cfg?.allowedApps) ? cfg.allowedApps : [];
        if (!allowed.includes(app))
            throw new Error('bridge: программа «' + app + '» не входит в разрешённый список моста (' + (allowed.join(', ') || 'пусто') + ')');
        const safeArgs = Array.isArray(cmd.args) ? cmd.args.map(a => String(a)).slice(0, 8) : [];
        for (const a of safeArgs)
            if (a.includes('\0') || /[;&|`$<>]/.test(a))
                throw new Error('bridge: недопустимый аргумент программы: ' + a);
        if (typeof cfg?.spawnApp === 'function') {
            const r = await cfg.spawnApp(app, safeArgs);
            return { started: app, args: safeArgs, pid: r?.pid || 0 };
        }
        const child = spawn(app, safeArgs, { cwd: rootDir, shell: false, detached: true, stdio: 'ignore' });
        child.unref();
        return { started: app, args: safeArgs, pid: child.pid || 0 };
    }

    throw new Error('bridge: неизвестная операция «' + op + '»');
}

/**
 * Зарегистрировать или обновить подключение моста для пользователя uid.
 * localHandler (необязательно) — прямое исполнение (для локального моста или тестов),
 * иначе команды ставятся в очередь queue и забираются клиентом моста по HTTP /~bridge/poll.
 */
export function registerBridge({ uid, hostname, platform, rootDir, readOnly = false, allowedApps = [], localHandler = null }) {
    if (!uid)
        throw new Error('bridge: нужен uid пользователя');
    const prev = bridges.get(uid);
    const session = {
        uid: String(uid),
        id: prev?.id || ('br-' + randomBytes(6).toString('hex')),
        hostname: String(hostname || os.hostname()),
        platform: String(platform || process.platform),
        rootDir: String(rootDir || process.cwd()),
        readOnly: Boolean(readOnly),
        allowedApps: Array.isArray(allowedApps) ? allowedApps.map(String) : [],
        connectedAt: prev?.connectedAt || Date.now(),
        lastSeen: Date.now(),
        localHandler,
        queue: prev?.queue || [],
        pending: prev?.pending || new Map(),
        history: prev?.history || [],
    };
    bridges.set(String(uid), session);
    recordLog(session, { action: 'register', hostname: session.hostname, readOnly: session.readOnly, outcome: 'ok' });
    return session;
}

/** Отключить мост пользователя. */
export function unregisterBridge(uid) {
    const s = bridges.get(String(uid || ''));
    if (!s)
        return false;
    for (const [, p] of s.pending)
        p.reject(new Error('мост отключён'));
    s.pending.clear();
    bridges.delete(String(uid));
    return true;
}

/** Получить активный мост ТОЛЬКО для владельца uid (строгая изоляция по пользователю). */
export function getBridgeForUser(uid) {
    const s = bridges.get(String(uid || ''));
    if (!s)
        return null;
    if (Date.now() - s.lastSeen > BRIDGE_TTL_MS) {
        unregisterBridge(uid);
        return null;
    }
    return s;
}

/** Переключить режим «только просмотр» (readOnly) моста пользователя. */
export function setBridgeReadOnly(uid, readOnly) {
    const s = getBridgeForUser(uid);
    if (!s)
        throw new Error('мост компьютера не подключён');
    s.readOnly = Boolean(readOnly);
    s.lastSeen = Date.now();
    recordLog(s, { action: 'mode', readOnly: s.readOnly, outcome: 'ok' });
    return { uid: s.uid, readOnly: s.readOnly };
}

/**
 * Отправить команду на мост пользователя uid и дождаться результата.
 * Проверяет владение (uid), активность моста, режим «только просмотр» (readOnly) и пишет в журнал.
 */
export async function dispatchBridgeCommand(uid, cmd) {
    const s = getBridgeForUser(uid);
    if (!s)
        throw new Error('На вашем компьютере не запущен агент-«мост» WORK (или связь потеряна). Запустите scripts/work-desktop-bridge.mjs.');
    const op = String(cmd?.op || '');
    const target = String(cmd?.path || cmd?.app || cmd?.title || op);
    if (s.readOnly && WRITE_OPS.has(op)) {
        recordLog(s, { action: op, target, readOnly: true, outcome: 'denied_readonly' });
        throw new Error('Компьютер в режиме «только просмотр» (readOnly): действие «' + op + '» запрещено.');
    }
    s.lastSeen = Date.now();
    try {
        let res;
        if (typeof s.localHandler === 'function') {
            res = await s.localHandler(cmd, s);
        }
        else {
            const callId = 'cmd-' + randomBytes(6).toString('hex');
            res = await new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    s.pending.delete(callId);
                    reject(new Error('bridge: таймаут ответа от компьютера пользователя (' + op + ')'));
                }, CMD_TIMEOUT_MS);
                s.pending.set(callId, {
                    resolve: v => { clearTimeout(timer); resolve(v); },
                    reject: e => { clearTimeout(timer); reject(e); },
                });
                s.queue.push({ id: callId, ...cmd });
            });
        }
        recordLog(s, { action: op, target, readOnly: s.readOnly, outcome: 'ok' });
        return res;
    }
    catch (e) {
        recordLog(s, { action: op, target, readOnly: s.readOnly, outcome: 'error', error: String(e?.message || e).slice(0, 200) });
        throw e;
    }
}

// ── HTTP-транспорт /~bridge/* для удалённого процесса моста ─────────────────

function replyJson(res, status, obj) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(JSON.stringify(obj));
}

async function readBodyJson(req) {
    const chunks = [];
    let len = 0;
    for await (const c of req) {
        len += c.length;
        if (len > 2 * 1024 * 1024)
            throw new Error('тело больше 2 МБ');
        chunks.push(c);
    }
    return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf-8')) : {};
}

export async function handleBridgeHttp(req, res) {
    const urlPath = String(req.url || '').split('?')[0];
    if (!urlPath.startsWith('/~bridge/'))
        return false;
    if (!clientAllowed(req)) {
        replyJson(res, 403, { error: 'Мост доступен только с этого компьютера или локальной сети' });
        return true;
    }
    const hdr = String(req.headers.authorization || '');
    const rawToken = /^Bearer\s+(\S+)$/i.exec(hdr)?.[1] || '';
    const auth = await verifyToken(rawToken);
    if (!auth) {
        replyJson(res, 401, { error: 'Нужен токен Authorization: Bearer wmcp.<uid>.<секрет>' });
        return true;
    }

    if (urlPath === '/~bridge/register' && req.method === 'POST') {
        const body = await readBodyJson(req);
        const s = registerBridge({
            uid: auth.uid,
            hostname: body.hostname,
            platform: body.platform,
            rootDir: body.rootDir,
            readOnly: Boolean(body.readOnly),
            allowedApps: body.allowedApps,
        });
        replyJson(res, 200, { ok: true, id: s.id, uid: s.uid, readOnly: s.readOnly });
        return true;
    }

    if (urlPath === '/~bridge/poll' && req.method === 'GET') {
        const s = getBridgeForUser(auth.uid);
        if (!s) {
            replyJson(res, 404, { error: 'Мост не зарегистрирован' });
            return true;
        }
        s.lastSeen = Date.now();
        const cmd = s.queue.shift() || null;
        replyJson(res, 200, { ok: true, readOnly: s.readOnly, command: cmd });
        return true;
    }

    if (urlPath === '/~bridge/result' && req.method === 'POST') {
        const s = getBridgeForUser(auth.uid);
        if (!s) {
            replyJson(res, 404, { error: 'Мост не зарегистрирован' });
            return true;
        }
        s.lastSeen = Date.now();
        const body = await readBodyJson(req);
        const p = s.pending.get(String(body.id || ''));
        if (p) {
            s.pending.delete(String(body.id));
            if (body.error)
                p.reject(new Error(String(body.error)));
            else
                p.resolve(body.result);
        }
        replyJson(res, 200, { ok: true });
        return true;
    }

    replyJson(res, 404, { error: 'Неизвестный маршрут моста' });
    return true;
}
