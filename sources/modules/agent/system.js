/**
 * Доступ агента к операционной системе сервера и локальной сети — политика, аудит, запуск команд.
 *
 * Только администраторы WORK (роль ADMIN в корне). Настройка — #system/os.json (правит админ):
 *   {
 *     enabled: true,              // выключатель
 *     roots: [],                  // разрешённые папки ОС; [] — любые (кроме deny)
 *     deny: [],                   // доп. запрещённые пути/маски (к встроенным)
 *     subnets: [],                // сети для активного сканирования (CIDR); [] — частные сети интерфейсов сервера
 *     shell: 'ask',               // 'ask' — каждая команда с подтверждением | 'off'
 *     maxScanHosts: 1024
 *   }
 * Дерево WORK файловыми os_* недоступно: там работают WORK-инструменты (права, история, журнал).
 * Вызовы os_*, net_* пишутся в общий журнал безопасности (.index/audit).
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { clip } from './util.js';

export const IS_WIN = process.platform === 'win32';

const DEFAULTS = { enabled: true, roots: [], deny: [], subnets: [], shell: 'ask', maxScanHosts: 1024 };

/**
 * Встроенные запреты (снять нельзя, только дополнить в #system/os.json deny):
 * ключи и сертификаты, хранилища учётных данных ОС и браузеров, менеджеры паролей.
 */
const BUILTIN_DENY = [
    '*.pem', '*.pfx', '*.p12', '*.key', '*.kdbx', '*.keychain', '*.keychain-db', 'id_rsa*', 'id_ed25519*', 'id_ecdsa*',
    '.netrc', '.pgpass', '.git-credentials', 'wallet.dat', 'Login Data', 'Cookies', 'key4.db', 'logins.json',
    '~/.ssh', '~/.gnupg', '~/.aws', '~/.azure', '~/.kube', '~/.docker', '~/.config/gcloud',
    '~/AppData/Roaming/Microsoft/Credentials', '~/AppData/Local/Microsoft/Credentials', '~/AppData/Roaming/Microsoft/Protect',
    '/etc/shadow', '/etc/gshadow', '/etc/sudoers', '/etc/ssl/private', '/root/.ssh',
    'C:/Windows/System32/config', 'C:/Windows/NTDS',
];

function workRoot() {
    return process.cwd();
}

export function loadConfig() {
    try {
        const raw = JSON.parse(fs.readFileSync(path.join(workRoot(), '#system', 'os.json'), 'utf-8'));
        return { ...DEFAULTS, ...raw };
    }
    catch {
        return { ...DEFAULTS };
    }
}

let adminCheck = null;
/** Для тестов: подменить проверку администратора (session) => boolean. */
export function setAdminCheck(fn) {
    adminCheck = fn;
}

/** Пользователь сессии — администратор WORK (ADMIN в корне дерева). */
export async function isAdmin(session) {
    if (session?.principal?.kind === 'node')
        return false;
    if (adminCheck)
        return !!(await adminCheck(session));
    if (!session?.uid)
        return false;
    try {
        const roles = await globalThis.WORK?.roles?.({ session });
        return Array.isArray(roles) && roles.includes('ADMIN');
    }
    catch {
        return false;
    }
}

/** Доступ к ОС/сети открыт этому пользователю. */
export async function systemAllowed(session) {
    return loadConfig().enabled !== false && await isAdmin(session);
}

export async function assertAdmin(session) {
    if (loadConfig().enabled === false)
        throw new Error('доступ к ОС и сети выключен (#system/os.json enabled:false)');
    if (!await isAdmin(session))
        throw new Error('ОС и локальная сеть доступны только администраторам WORK');
}

// ── пути ──────────────────────────────────────────────────────────────────

function expand(p) {
    let s = String(p ?? '').trim();
    if (s === '~' || s.startsWith('~/') || s.startsWith('~\\'))
        s = path.join(os.homedir(), s.slice(1));
    return s;
}

/** Ключ сравнения: абсолютный, прямые слэши, без хвоста, на Windows — без регистра. */
function key(p) {
    let s = path.resolve(p).replace(/\\/g, '/').replace(/\/+$/, '');
    if (IS_WIN)
        s = s.toLowerCase();
    return s || '/';
}

function inside(child, parent) {
    const c = key(child), p = key(parent);
    return c === p || c.startsWith(p.endsWith('/') ? p : p + '/');
}

function realOrSelf(p) {
    try {
        return fs.realpathSync.native(p);
    }
    catch {
        // не существует — проверяем ближайшего существующего предка (симлинк в середине пути)
        const parent = path.dirname(p);
        if (parent === p)
            return p;
        return path.join(realOrSelf(parent), path.basename(p));
    }
}

function maskRe(mask) {
    return new RegExp('^' + mask.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
}

/**
 * Проверить путь ОС → абсолютный путь. Бросает при нарушении политики.
 * @param {string} p
 * @param {{ write?: boolean }} [opt]
 */
export function checkPath(p, opt = {}) {
    const raw = expand(p);
    if (!raw)
        throw new Error('нужен путь ОС (абсолютный, ~ — домашняя папка)');
    if (!path.isAbsolute(raw))
        throw new Error('путь ОС должен быть абсолютным: ' + raw);
    const abs = path.resolve(raw);
    const real = realOrSelf(abs);
    const cfg = loadConfig();
    for (const cand of new Set([abs, real])) {
        if (inside(cand, workRoot()) || inside(cand, realOrSelf(workRoot())))
            throw new Error('это дерево WORK (' + workRoot() + ') — работай WORK-инструментами (ls/read/write…), os_* — только за его пределами');
        if (opt.write && (inside(workRoot(), cand) || inside(realOrSelf(workRoot()), cand)))
            throw new Error('Нельзя изменять/перемещать родительскую папку дерева WORK');
        for (const d of [...BUILTIN_DENY, ...(cfg.deny || [])]) {
            const s = String(d);
            if (!/[\\/]/.test(s)) {
                // без разделителя — маска имени любого сегмента пути (Cookies, *.key, id_rsa*)
                const re = maskRe(s);
                if (cand.split(/[\\/]/).some(seg => re.test(seg)))
                    throw new Error('запрещено политикой (' + s + '): ' + cand);
            }
            else if (inside(cand, expand(s)))
                throw new Error('запрещено политикой (' + s + '): ' + cand);
        }
        const roots = (cfg.roots || []).map(expand).filter(Boolean);
        if (roots.length && !roots.some(r => inside(cand, r)))
            throw new Error('вне разрешённых папок (#system/os.json roots: ' + roots.join(', ') + '): ' + cand);
    }
    return abs;
}

// ── аудит ─────────────────────────────────────────────────────────────────

const SECRET_KEY = /pass|secret|token|key|pwd|content|old_string|new_string/i;

function scrub(v, depth = 0) {
    if (depth > 3)
        return '[…]';
    if (v == null)
        return v;
    if (typeof v === 'string')
        return clip(v, 500);
    if (Array.isArray(v))
        return v.slice(0, 20).map(x => scrub(x, depth + 1));
    if (typeof v === 'object') {
        const out = {};
        for (const [k, x] of Object.entries(v))
            out[k] = SECRET_KEY.test(k) ? '***' : scrub(x, depth + 1);
        return out;
    }
    return v;
}

/** Запись в общий журнал безопасности (server/access/audit.js, просмотр — WORK.security_log). */
export function audit(rec, session) {
    import('../../server/access/audit.js')
        .then(m => m.audit('system', { ...scrub(rec), params: session ? { session } : undefined }))
        .catch(() => { /* аудит не должен ронять работу */ });
}

/**
 * Обернуть инструменты: доступ только админу + аудит каждого вызова.
 * @param {Array} tools
 */
export function guarded(tools) {
    return tools.map(t => ({
        ...t,
        system: true,
        async run(args, ctx) {
            const t0 = Date.now();
            try {
                await assertAdmin(ctx?.session);
                const res = await t.run(args, ctx);
                audit({ tool: t.name, args, ok: !res?.error, error: res?.error, ms: Date.now() - t0 }, ctx?.session);
                return res;
            }
            catch (e) {
                audit({ tool: t.name, args, ok: false, error: String(e?.message || e), ms: Date.now() - t0 }, ctx?.session);
                throw e;
            }
        },
    }));
}

// ── подтверждения ─────────────────────────────────────────────────────────

/** Изменение в ОС: подтверждение; «разрешить всегда» — можно. */
export function askOnce(reason) {
    return (args, ctx) => ctx?.host?.allowed?.has?.(ctx.entry?.name) ? { verdict: 'allow' } : { verdict: 'ask', reason: reason(args) };
}

/** Опасное действие: каждый раз отдельно, без «разрешить всегда». */
export function askEach(reason) {
    return args => ({ verdict: 'ask', noAlways: true, reason: reason(args) });
}

// ── команды ───────────────────────────────────────────────────────────────

/**
 * Запустить программу (без оболочки) → { code, stdout, stderr, timedOut }.
 * @param {string} file
 * @param {string[]} args
 * @param {{ cwd?, timeout?, signal?, env?, input?, max? }} [o]
 */
export function run(file, args = [], o = {}) {
    o.signal?.throwIfAborted();
    const max = o.max || 200_000;
    return new Promise((resolve, reject) => {
        let out = '', err = '', timedOut = false, done = false;
        const child = spawn(file, args, {
            cwd: o.cwd, env: o.env ? { ...process.env, ...o.env } : process.env,
            windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], shell: !!o.shell,
        });
        const kill = () => {
            try {
                if (IS_WIN && child.pid)
                    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
                else
                    child.kill('SIGKILL');
            }
            catch { /* уже завершён */ }
        };
        const timer = setTimeout(() => { timedOut = true; kill(); }, o.timeout || 60_000);
        const onAbort = () => kill();
        o.signal?.addEventListener?.('abort', onAbort, { once: true });
        child.stdout.on('data', c => { if (out.length < max) out += c.toString('utf-8'); });
        child.stderr.on('data', c => { if (err.length < max) err += c.toString('utf-8'); });
        child.on('error', e => {
            if (done)
                return;
            done = true;
            clearTimeout(timer);
            o.signal?.removeEventListener?.('abort', onAbort);
            reject(e);
        });
        child.on('close', code => {
            if (done)
                return;
            done = true;
            clearTimeout(timer);
            o.signal?.removeEventListener?.('abort', onAbort);
            resolve({ code, stdout: out, stderr: err, timedOut, aborted: !!o.signal?.aborted });
        });
        if (o.input != null)
            child.stdin.end(String(o.input));
        else
            child.stdin.end();
    });
}

/** PowerShell-скрипт (Windows) с UTF-8 выводом. */
export function powershell(script, o = {}) {
    const exe = o.pwsh ? 'pwsh' : 'powershell.exe';
    const pre = '$ProgressPreference="SilentlyContinue";[Console]::OutputEncoding=[Text.Encoding]::UTF8;$OutputEncoding=[Text.Encoding]::UTF8;';
    return run(exe, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', pre + script], o);
}

/** Строка в одинарных кавычках PowerShell. */
export function psQuote(s) {
    return "'" + String(s).replace(/'/g, "''") + "'";
}

/** Результат команды → текст для модели. */
export function formatRun(r, limit = 20000) {
    const parts = [];
    if (r.timedOut)
        parts.push('[таймаут — процесс остановлен]');
    if (r.aborted)
        parts.push('[остановлено пользователем]');
    parts.push('код выхода: ' + r.code);
    if (r.stdout.trim())
        parts.push('stdout:\n' + clip(r.stdout.replace(/\s+$/, ''), limit));
    if (r.stderr.trim())
        parts.push('stderr:\n' + clip(r.stderr.replace(/\s+$/, ''), Math.floor(limit / 3)));
    return parts.join('\n');
}
