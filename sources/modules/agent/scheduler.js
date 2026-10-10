/**
 * Расписание задач агента: запуск `.task` по времени от имени её владельца.
 * Запуск = новая реплика в ту же задачу (session.prompt): лента, подтверждения, push — как при ручном
 * сообщении. Автономно агент ничего опасного не сделает: действие с подтверждением ждёт человека.
 *
 * Правило: { at: 'HH:MM', days?: [1..7] (пн=1), tz? } | { every: минут (≥15) } | { once: ISO-время }.
 * Хранение — общая БД индексов (таблица agent_schedules).
 */
import { randomUUID } from 'node:crypto';
import { indexDb, registerSchema } from '../../host/index-db.js';

registerSchema(`
CREATE TABLE IF NOT EXISTS agent_schedules(
    id TEXT PRIMARY KEY,
    uid TEXT NOT NULL,
    task TEXT NOT NULL,
    label TEXT,
    prompt TEXT NOT NULL,
    rule TEXT NOT NULL,
    tz TEXT,
    next INTEGER,
    last INTEGER,
    last_error TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    created INTEGER
);
CREATE INDEX IF NOT EXISTS agent_schedules_next ON agent_schedules(enabled, next);
CREATE INDEX IF NOT EXISTS agent_schedules_uid ON agent_schedules(uid);
`);

export const MIN_EVERY_MIN = 15;
export const MAX_PER_USER = 20;
const TICK_MS = 30_000;

function validTz(tz) {
    if (!tz)
        return 'Europe/Moscow';
    try {
        new Intl.DateTimeFormat('ru', { timeZone: tz });
        return tz;
    }
    catch {
        throw new Error('неизвестный часовой пояс: ' + tz);
    }
}

/** Местное время t в поясе tz: {y, m, d, hh, mm, dow (1=пн)}. */
function local(t, tz) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
        hour: 'numeric', minute: 'numeric', weekday: 'short',
    }).formatToParts(new Date(t)).map(p => [p.type, p.value]));
    const dow = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(parts.weekday) + 1;
    return { y: +parts.year, m: +parts.month, d: +parts.day, hh: +parts.hour, mm: +parts.minute, dow };
}

/** UTC-время для местных даты и времени в поясе tz. */
function utcOf(y, m, d, hh, mm, tz) {
    let guess = Date.UTC(y, m - 1, d, hh, mm);
    for (let i = 0; i < 2; i++) {
        const l = local(guess, tz);
        const shift = Date.UTC(l.y, l.m - 1, l.d, l.hh, l.mm) - guess;
        guess = Date.UTC(y, m - 1, d, hh, mm) - shift;
    }
    return guess;
}

/** Нормализовать правило (бросает при ошибке). */
export function normalizeRule(rule = {}) {
    if (rule.once) {
        const t = Date.parse(rule.once);
        if (!Number.isFinite(t))
            throw new Error('once: нужна дата-время ISO, например 2026-10-01T09:00:00+03:00');
        return { once: new Date(t).toISOString() };
    }
    if (rule.every != null) {
        const every = Math.round(Number(rule.every));
        if (!Number.isFinite(every) || every < MIN_EVERY_MIN || every > 7 * 24 * 60)
            throw new Error('every: от ' + MIN_EVERY_MIN + ' минут до недели');
        return { every };
    }
    const m = String(rule.at || '').match(/^(\d{1,2}):(\d{2})$/);
    if (!m || +m[1] > 23 || +m[2] > 59)
        throw new Error('нужно at "ЧЧ:ММ", every (минуты) или once (дата-время)');
    const days = rule.days == null ? [1, 2, 3, 4, 5, 6, 7] : [...new Set([].concat(rule.days).map(Number))];
    if (!days.length || days.some(d => !Number.isInteger(d) || d < 1 || d > 7))
        throw new Error('days: числа 1–7 (1 — понедельник)');
    return { at: m[1].padStart(2, '0') + ':' + m[2], days: days.sort() };
}

/** Следующий запуск после from (мс) или null (разовое уже прошло). */
export function nextRun(rule, tz, from = Date.now()) {
    tz = validTz(tz);
    if (rule.once) {
        const t = Date.parse(rule.once);
        return t > from ? t : null;
    }
    if (rule.every)
        return from + rule.every * 60_000;
    const [hh, mm] = rule.at.split(':').map(Number);
    const today = local(from, tz);
    for (let i = 0; i <= 8; i++) {
        const base = Date.UTC(today.y, today.m - 1, today.d + i, 12);
        const day = local(base, tz);
        if (!rule.days.includes(day.dow))
            continue;
        const t = utcOf(day.y, day.m, day.d, hh, mm, tz);
        if (t > from)
            return t;
    }
    return null;
}

export function describeRule(rule) {
    if (rule.once)
        return 'однократно ' + rule.once;
    if (rule.every)
        return 'каждые ' + rule.every + ' мин';
    const names = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
    const days = rule.days.length === 7 ? 'ежедневно' : rule.days.map(d => names[d - 1]).join(',');
    return days + ' в ' + rule.at;
}

function row2obj(r) {
    const rule = JSON.parse(r.rule);
    return {
        id: r.id, task: r.task, label: r.label, prompt: r.prompt, rule, when: describeRule(rule), tz: r.tz,
        next: r.next ? new Date(r.next).toISOString() : null,
        last: r.last ? new Date(r.last).toISOString() : null,
        lastError: r.last_error || undefined, enabled: !!r.enabled,
    };
}

async function db() {
    const d = await indexDb();
    if (!d)
        throw new Error('расписание недоступно: нет локальной БД (node:sqlite)');
    return d;
}

export async function createSchedule({ uid, task, label, prompt, rule, tz }) {
    if (!uid || !task)
        throw new Error('расписание: нужны владелец и задача');
    const text = String(prompt || '').trim();
    if (!text || text.length > 4000)
        throw new Error('prompt: 1–4000 символов');
    const r = normalizeRule(rule);
    tz = validTz(tz);
    const d = await db();
    if (d.prepare('SELECT COUNT(*) AS n FROM agent_schedules WHERE uid = ?').get(uid).n >= MAX_PER_USER)
        throw new Error('не больше ' + MAX_PER_USER + ' расписаний на пользователя');
    const next = nextRun(r, tz);
    if (!next)
        throw new Error('время запуска уже прошло');
    const id = randomUUID().slice(0, 8);
    d.prepare('INSERT INTO agent_schedules(id, uid, task, label, prompt, rule, tz, next, enabled, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)')
        .run(id, uid, task, String(label || text.split('\n')[0]).slice(0, 120), text, JSON.stringify(r), tz, next, Date.now());
    return row2obj(d.prepare('SELECT * FROM agent_schedules WHERE id = ?').get(id));
}

export async function listSchedules({ uid, task } = {}) {
    const d = await db();
    const rows = task
        ? d.prepare('SELECT * FROM agent_schedules WHERE uid = ? AND task = ? ORDER BY next').all(uid, task)
        : d.prepare('SELECT * FROM agent_schedules WHERE uid = ? ORDER BY next').all(uid);
    return rows.map(row2obj);
}

export async function cancelSchedule({ uid, id }) {
    const d = await db();
    const res = d.prepare('DELETE FROM agent_schedules WHERE id = ? AND uid = ?').run(String(id), uid);
    if (!res.changes)
        throw new Error('расписание ' + id + ' не найдено');
    return true;
}

/** Выполнить наступившие запуски (вызывается таймером; тесты — напрямую). */
export async function runDue(now = Date.now(), runner = defaultRunner) {
    const d = await indexDb();
    if (!d)
        return [];
    const due = d.prepare('SELECT * FROM agent_schedules WHERE enabled = 1 AND next <= ? ORDER BY next LIMIT 20').all(now);
    const done = [];
    for (const r of due) {
        const rule = JSON.parse(r.rule);
        const next = nextRun(rule, r.tz, now);
        let error = null;
        try {
            await runner(r);
        }
        catch (e) {
            error = String(e?.message || e).slice(0, 500);
        }
        // отозван доступ / нет задачи — выключаем, чтобы не повторять вечно
        const fatal = error && /нет задачи|нет пользователя|Доступ запрещён/.test(error);
        d.prepare('UPDATE agent_schedules SET last = ?, last_error = ?, next = ?, enabled = ? WHERE id = ?')
            .run(now, error, next, next && !fatal ? 1 : 0, r.id);
        done.push({ id: r.id, error });
    }
    return done;
}

async function defaultRunner(r) {
    const WORK = globalThis.WORK;
    let user = await (await WORK.$users)?.get_item('//' + r.uid);
    if (Array.isArray(user))
        user = user[0];
    if (!user)
        throw new Error('нет пользователя ' + r.uid);
    let file = await WORK.get_item(r.task);
    if (Array.isArray(file))
        file = file.at(-1);
    if (!file || typeof file.prompt !== 'function') {
        await file?.init;
        if (!file || typeof file.prompt !== 'function')
            throw new Error('нет задачи ' + r.task);
    }
    // сессия владельца (внутренняя, без cookie): те же права, что при ручном сообщении
    const session = { uid: r.uid, $user: user, principal: Object.freeze({ kind: 'user', id: r.uid }), scheduled: true, sockets: {}, send() {} };
    await file.assertAccess({ session }, 'read');
    const stamp = new Date().toLocaleString('ru-RU', { timeZone: r.tz || undefined });
    await file.prompt({ session, prompt: '[по расписанию «' + r.label + '», ' + stamp + ']\n' + r.prompt });
}

let timer = null;
let busy = false;

export function startScheduler() {
    if (timer)
        return;
    timer = setInterval(async () => {
        if (busy)
            return;
        busy = true;
        try {
            await runDue();
        }
        catch (e) {
            console.warn('[scheduler]', e.message);
        }
        finally {
            busy = false;
        }
    }, TICK_MS);
    timer.unref?.();
}

export function stopScheduler() {
    clearInterval(timer);
    timer = null;
}
