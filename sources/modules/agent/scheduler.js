/**
 * Расписание задач агента: запуск `.task` по времени от имени её владельца.
 * Запуск = новая реплика в ту же задачу (session.prompt): лента, подтверждения, push — как при ручном
 * сообщении. Автономно агент ничего опасного не сделает: действие с подтверждением ждёт человека.
 *
 * Правило: { at: 'HH:MM', days?: [1..7] (пн=1), workdays?: true } | { every: минут (≥15) } | { once: ISO-время }
 *   | { date: 'YYYY-MM-DD', at: 'HH:MM', repeat?: 'once'|'monthly'|'yearly' } — календарные даты (9.8):
 *     конкретный день (однократно), каждый месяц в это число (29–31 в коротком месяце — месяц пропускается),
 *     каждый год в эту дату (29 февраля в невисокосный год — последний день февраля).
 * Хранение — общая БД индексов (таблица agent_schedules).
 */
import { randomUUID } from 'node:crypto';
import { indexDb, registerSchema } from '../../host/index-db.js';

registerSchema(`
CREATE TABLE IF NOT EXISTS agent_schedules(
    id TEXT PRIMARY KEY,
    uid TEXT NOT NULL,
    task TEXT NOT NULL DEFAULT '',
    node_path TEXT NOT NULL DEFAULT '',
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

/** Дней в месяце года (григорианский, по UTC — пояс не важен). */
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Разбор ODANT-маски времени вида YYYY-MM-05T10:15:00 (YYYY/MM/DD/HH/mm — любое значение). */
export function parseTimeMask(rawMask) {
    const src = String(rawMask ?? '').trim();
    const m = src.match(/^(\d{4}|[Yy]{4})-(\d{2}|[Mm]{2})-(\d{2}|[Dd]{2})[T ](\d{2}|[Hh]{2}):(\d{2}|[Mm]{2})(?::(\d{2}|[Ss]{2}))?$/);
    if (!m)
        throw new Error('mask: формат YYYY-MM-DDTHH:MM:00 (например YYYY-MM-05T10:15:00)');
    const [, yStr, moStr, dStr, hStr, minStr] = m;
    const y = /^[Yy]{4}$/.test(yStr) ? null : Number(yStr);
    const mo = /^[Mm]{2}$/.test(moStr) ? null : Number(moStr);
    const d = /^[Dd]{2}$/.test(dStr) ? null : Number(dStr);
    const hh = /^[Hh]{2}$/.test(hStr) ? null : Number(hStr);
    const mm = /^[Mm]{2}$/.test(minStr) ? null : Number(minStr);
    if (y !== null && (y < 1970 || y > 2199))
        throw new Error('mask: год должен быть 1970–2199 или YYYY');
    if (mo !== null && (mo < 1 || mo > 12))
        throw new Error('mask: месяц должен быть 01–12 или MM');
    if (d !== null && (d < 1 || d > 31))
        throw new Error('mask: день должен быть 01–31 или DD');
    if (hh !== null && (hh < 0 || hh > 23))
        throw new Error('mask: час должен быть 00–23 или HH');
    if (mm !== null && (mm < 0 || mm > 59))
        throw new Error('mask: минуты должны быть 00–59 или MM');
    if (hh === null && mm === null)
        throw new Error('mask: укажите хотя бы час или минуты (для более редкого интервала используйте каждые N минут)');
    const norm = `${y === null ? 'YYYY' : String(y).padStart(4, '0')}-${mo === null ? 'MM' : String(mo).padStart(2, '0')}-${d === null ? 'DD' : String(d).padStart(2, '0')}T${hh === null ? 'HH' : String(hh).padStart(2, '0')}:${mm === null ? 'MM' : String(mm).padStart(2, '0')}:00`;
    return { norm, y, mo, d, hh, mm };
}

function nextRunMask(maskStr, tz, from) {
    const { y, mo, d, hh, mm } = parseTimeMask(maskStr);
    const now = local(from, tz);
    const years = y !== null
        ? (y < now.y ? [] : [y])
        : [now.y, now.y + 1, now.y + 2, now.y + 3, now.y + 4];
    const months = mo !== null ? [mo] : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const hours = hh !== null ? [hh] : Array.from({ length: 24 }, (_, i) => i);
    const mins = mm !== null ? [mm] : Array.from({ length: 60 }, (_, i) => i);
    for (const yy of years) {
        for (const m2 of months) {
            if (yy === now.y && m2 < now.m)
                continue;
            const maxD = daysInMonth(yy, m2);
            const days = d !== null ? (d <= maxD ? [d] : []) : Array.from({ length: maxD }, (_, i) => i + 1);
            for (const dd of days) {
                if (yy === now.y && m2 === now.m && dd < now.d)
                    continue;
                for (const h of hours) {
                    if (yy === now.y && m2 === now.m && dd === now.d && h < now.hh)
                        continue;
                    for (const min of mins) {
                        const t = utcOf(yy, m2, dd, h, min, tz);
                        if (t > from)
                            return t;
                    }
                }
            }
        }
    }
    return null;
}

/** Нормализовать правило (бросает при ошибке). */
export function normalizeRule(rule = {}) {
    if (rule.scope != null && rule.scope !== '' && !['personal', 'department'].includes(String(rule.scope)))
        throw new Error('scope: personal (лично) | department (общее по подразделению)');
    const extra = rule.scope === 'department' ? { scope: 'department' } : {};
    if (rule.mask != null && String(rule.mask).trim() !== '') {
        const parsed = parseTimeMask(rule.mask);
        const days = Array.isArray(rule.days) && rule.days.length
            ? [...new Set(rule.days.map(Number))].filter(d => Number.isInteger(d) && d >= 1 && d <= 7).sort()
            : null;
        return { mask: parsed.norm, ...(days?.length ? { days } : {}), ...extra };
    }
    if (rule.once) {
        const t = Date.parse(rule.once);
        if (!Number.isFinite(t))
            throw new Error('once: нужна дата-время ISO, например 2026-10-01T09:00:00+03:00');
        return { once: new Date(t).toISOString(), ...extra };
    }
    if (rule.every != null) {
        const every = Math.round(Number(rule.every));
        if (!Number.isFinite(every) || every < MIN_EVERY_MIN || every > 7 * 24 * 60)
            throw new Error('every: от ' + MIN_EVERY_MIN + ' минут до недели');
        const out = { every, ...extra };
        if (rule.at != null && String(rule.at).trim() !== '') {
            const m = String(rule.at).trim().match(/^(\d{1,2}):(\d{2})$/);
            if (!m || +m[1] > 23 || +m[2] > 59)
                throw new Error('at: время ЧЧ:ММ');
            out.at = m[1].padStart(2, '0') + ':' + m[2];
        }
        if (rule.date != null && String(rule.date).trim() !== '') {
            const dm = String(rule.date).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
            if (!dm || +dm[2] < 1 || +dm[2] > 12 || +dm[3] < 1 || +dm[3] > 31)
                throw new Error('date: дата YYYY-MM-DD, например 2026-10-20');
            out.date = dm[0];
        }
        if (rule.until != null && String(rule.until).trim() !== '') {
            const u = String(rule.until).trim();
            const um = u.match(/^(\d{1,2}):(\d{2})$/);
            if (um) {
                if (+um[1] > 23 || +um[2] > 59)
                    throw new Error('until: время ЧЧ:ММ или ISO дата-время');
                out.until = um[1].padStart(2, '0') + ':' + um[2];
            }
            else {
                const ut = Date.parse(u);
                if (!Number.isFinite(ut))
                    throw new Error('until: время ЧЧ:ММ или ISO дата-время');
                out.until = new Date(ut).toISOString();
            }
        }
        return out;
    }
    // 9.8: календарная дата — конкретный день (однократно), ежемесячно или ежегодно
    if (rule.date != null) {
        const dm = String(rule.date).match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!dm || +dm[2] < 1 || +dm[2] > 12 || +dm[3] < 1 || +dm[3] > 31)
            throw new Error('date: дата YYYY-MM-DD, например 2026-10-20');
        const at = String(rule.at || '').match(/^(\d{1,2}):(\d{2})$/);
        if (!at || +at[1] > 23 || +at[2] > 59)
            throw new Error('для date нужно at "ЧЧ:ММ" — время запуска в этот день');
        const repeat = rule.repeat == null || rule.repeat === '' ? 'once' : String(rule.repeat);
        if (!['once', 'monthly', 'yearly'].includes(repeat))
            throw new Error('repeat: once (по умолчанию) | monthly | yearly');
        return { date: dm[0], at: at[1].padStart(2, '0') + ':' + at[2], repeat, ...extra };
    }
    const m = String(rule.at || '').match(/^(\d{1,2}):(\d{2})$/);
    if (!m || +m[1] > 23 || +m[2] > 59)
        throw new Error('нужно at "ЧЧ:ММ", every (минуты), once (дата-время) или date (календарная дата)');
    // 9.8: workdays — пн–пт (сахар над days)
    if (rule.workdays === true)
        return { at: m[1].padStart(2, '0') + ':' + m[2], days: [1, 2, 3, 4, 5], workdays: true, ...extra };
    const days = rule.days == null ? [1, 2, 3, 4, 5, 6, 7] : [...new Set([].concat(rule.days).map(Number))];
    if (!days.length || days.some(d => !Number.isInteger(d) || d < 1 || d > 7))
        throw new Error('days: числа 1–7 (1 — понедельник)');
    return { at: m[1].padStart(2, '0') + ':' + m[2], days: days.sort(), ...extra };
}

/** Следующий запуск после from (мс) или null (разовое уже прошло). */
export function nextRun(rule, tz, from = Date.now()) {
    tz = validTz(tz);
    if (rule.mask) {
        if (Array.isArray(rule.days) && rule.days.length) {
            let cur = from;
            for (let i = 0; i < 64; i++) {
                const candidate = nextRunMask(rule.mask, tz, cur);
                if (!candidate)
                    return null;
                if (rule.days.includes(local(candidate, tz).dow))
                    return candidate;
                cur = candidate;
            }
            return null;
        }
        return nextRunMask(rule.mask, tz, from);
    }
    if (rule.once) {
        const t = Date.parse(rule.once);
        return t > from ? t : null;
    }
    if (rule.every) {
        const step = rule.every * 60_000;
        let next;
        let anchorLocal = null;
        if (rule.at) {
            const nowLocal = local(from, tz);
            const [y, mo, d] = rule.date ? rule.date.split('-').map(Number) : [nowLocal.y, nowLocal.m, nowLocal.d];
            const [hh, mm] = rule.at.split(':').map(Number);
            anchorLocal = { y, m: mo, d };
            const startMs = utcOf(y, mo, d, hh, mm, tz);
            if (from < startMs)
                next = startMs;
            else
                next = startMs + (Math.floor((from - startMs) / step) + 1) * step;
        }
        else {
            next = from + step;
            if (rule.date) {
                const [y, mo, d] = rule.date.split('-').map(Number);
                anchorLocal = { y, m: mo, d };
                const dayStart = utcOf(y, mo, d, 0, 0, tz);
                if (next < dayStart)
                    next = dayStart;
            }
        }
        const effectiveUntil = rule.until || (rule.date ? '23:59' : null);
        if (effectiveUntil) {
            let untilMs;
            const um = String(effectiveUntil).match(/^(\d{2}):(\d{2})$/);
            if (um) {
                const base = anchorLocal || local(from, tz);
                untilMs = utcOf(base.y, base.m, base.d, +um[1], +um[2], tz) + 59_999;
            }
            else {
                untilMs = Date.parse(effectiveUntil);
            }
            if (Number.isFinite(untilMs) && next > untilMs)
                return null;
        }
        return next;
    }
    // 9.8: календарная дата — конкретный день / ежемесячно / ежегодно
    if (rule.date) {
        const [y, mo, dRaw] = rule.date.split('-').map(Number);
        const [hh, mm] = rule.at.split(':').map(Number);
        const now = local(from, tz);
        if (rule.repeat === 'monthly') {
            // 29–31 в коротком месяце — месяц пропускается (ищем ближайший существующий день)
            for (let i = 0; i <= 13; i++) {
                const t0 = new Date(Date.UTC(now.y, now.m - 1 + i, 1));
                const yy = t0.getUTCFullYear();
                const mm2 = t0.getUTCMonth() + 1;
                if (dRaw > daysInMonth(yy, mm2))
                    continue;
                const t = utcOf(yy, mm2, dRaw, hh, mm, tz);
                if (t > from)
                    return t;
            }
            return null;
        }
        if (rule.repeat === 'yearly') {
            // 29 февраля в невисокосный год — последний день февраля
            for (const yy of [now.y, now.y + 1]) {
                const d = Math.min(dRaw, daysInMonth(yy, mo));
                const t = utcOf(yy, mo, d, hh, mm, tz);
                if (t > from)
                    return t;
            }
            return null;
        }
        const t = utcOf(y, mo, dRaw, hh, mm, tz);
        return t > from ? t : null;
    }
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
    const suffix = rule.scope === 'department' ? ' [по подразделению]' : '';
    if (rule.mask) {
        let p;
        try { p = parseTimeMask(rule.mask); } catch { return rule.mask + suffix; }
        const timeStr = `${p.hh === null ? 'каждый час' : String(p.hh).padStart(2, '0')}:${p.mm === null ? '00' : String(p.mm).padStart(2, '0')}`;
        let dateDesc = '';
        if (p.y === null && p.mo === null && p.d === null) {
            if (Array.isArray(rule.days) && rule.days.length && rule.days.length < 7) {
                const isWorkdays = rule.days.join(',') === '1,2,3,4,5';
                const names = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
                dateDesc = isWorkdays ? 'по будням' : rule.days.map(d => names[d - 1]).join(', ');
            }
            else {
                dateDesc = 'ежедневно';
            }
        }
        else if (p.y === null && p.mo === null && p.d !== null) {
            dateDesc = `каждое ${p.d}-е число месяца`;
        }
        else if (p.y === null && p.mo !== null && p.d !== null) {
            dateDesc = `ежегодно ${String(p.d).padStart(2, '0')}.${String(p.mo).padStart(2, '0')}`;
        }
        else if (p.y !== null && p.mo !== null && p.d !== null) {
            dateDesc = `${String(p.d).padStart(2, '0')}.${String(p.mo).padStart(2, '0')}.${p.y}`;
        }
        else {
            dateDesc = rule.mask.split('T')[0];
        }
        const atText = p.hh === null ? `в :${String(p.mm).padStart(2, '0')} каждого часа` : `в ${timeStr}`;
        return `${dateDesc} ${atText}${suffix}`;
    }
    if (rule.once)
        return 'однократно ' + rule.once + suffix;
    if (rule.every) {
        let desc = 'каждые ' + rule.every + ' мин';
        if (rule.at)
            desc += ' с ' + rule.at;
        const untilStr = rule.until || (rule.date ? '23:59' : '');
        if (rule.date && untilStr)
            desc += ' (' + rule.date.split('-').reverse().join('.') + ' до ' + untilStr + ')';
        else if (rule.date)
            desc += ' (' + rule.date.split('-').reverse().join('.') + ')';
        else if (untilStr)
            desc += ' до ' + untilStr;
        return desc + suffix;
    }
    if (rule.date) {
        if (rule.repeat === 'monthly')
            return 'ежемесячно ' + Number(rule.date.slice(8)) + '-го в ' + rule.at + suffix;
        if (rule.repeat === 'yearly')
            return 'ежегодно ' + rule.date.slice(5) + ' в ' + rule.at + suffix;
        return rule.date.split('-').reverse().join('.') + ' в ' + rule.at + ' (однократно)' + suffix;
    }
    if (rule.workdays)
        return 'по рабочим дням в ' + rule.at + suffix;
    const names = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
    const days = rule.days.length === 7 ? 'ежедневно' : rule.days.map(d => names[d - 1]).join(',');
    return days + ' в ' + rule.at + suffix;
}

function row2obj(r) {
    const rule = JSON.parse(r.rule);
    return {
        id: r.id, uid: r.uid, task: r.task || '', nodePath: r.node_path || '',
        label: r.label, prompt: r.prompt, rule, when: describeRule(rule), tz: r.tz,
        next: r.next ? new Date(r.next).toISOString() : null,
        last: r.last ? new Date(r.last).toISOString() : null,
        lastError: r.last_error || undefined, enabled: !!r.enabled,
    };
}

let _colChecked = false;
async function db() {
    const d = await indexDb();
    if (!d)
        throw new Error('расписание недоступно: нет локальной БД (node:sqlite)');
    if (!_colChecked) {
        _colChecked = true;
        try {
            const cols = d.prepare('PRAGMA table_info(agent_schedules)').all().map(c => c.name);
            if (!cols.includes('node_path'))
                d.exec("ALTER TABLE agent_schedules ADD COLUMN node_path TEXT NOT NULL DEFAULT ''");
        }
        catch { /* ignore */ }
    }
    return d;
}

export async function createSchedule({ uid, task = '', nodePath = '', label, prompt, rule, tz }) {
    if (!uid || (!task && !nodePath))
        throw new Error('расписание: нужны владелец и задача или узел (nodePath)');
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
    d.prepare('INSERT INTO agent_schedules(id, uid, task, node_path, label, prompt, rule, tz, next, enabled, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)')
        .run(id, uid, String(task || ''), String(nodePath || ''), String(label || text.split('\n')[0]).slice(0, 120), text, JSON.stringify(r), tz, next, Date.now());
    return row2obj(d.prepare('SELECT * FROM agent_schedules WHERE id = ?').get(id));
}

export async function listSchedules({ uid, task, nodePath } = {}) {
    const d = await db();
    if (nodePath) {
        const rows = d.prepare('SELECT * FROM agent_schedules WHERE node_path = ? ORDER BY next').all(String(nodePath));
        return rows.map(row2obj);
    }
    const rows = task
        ? d.prepare('SELECT * FROM agent_schedules WHERE uid = ? AND task = ? ORDER BY next').all(uid, task)
        : d.prepare('SELECT * FROM agent_schedules WHERE uid = ? ORDER BY next').all(uid);
    return rows.map(row2obj);
}

export async function toggleSchedule({ id, enabled }) {
    const d = await db();
    const row = d.prepare('SELECT * FROM agent_schedules WHERE id = ?').get(String(id));
    if (!row)
        throw new Error('расписание ' + id + ' не найдено');
    const nextEnabled = enabled == null ? (row.enabled ? 0 : 1) : (enabled ? 1 : 0);
    const next = nextEnabled ? nextRun(JSON.parse(row.rule), row.tz) : row.next;
    d.prepare('UPDATE agent_schedules SET enabled = ?, next = ? WHERE id = ?').run(nextEnabled, next, String(id));
    return row2obj(d.prepare('SELECT * FROM agent_schedules WHERE id = ?').get(String(id)));
}

export async function cancelSchedule({ uid, id }) {
    const d = await db();
    const res = d.prepare('DELETE FROM agent_schedules WHERE id = ? AND uid = ?').run(String(id), uid);
    if (!res.changes)
        throw new Error('расписание ' + id + ' не найдено');
    return true;
}

let lastQuietDigestAt = 0;
let lastMailRefreshAt = 0;

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
    if (runner === defaultRunner && now - lastQuietDigestAt >= 15 * 60_000) {
        lastQuietDigestAt = now;
        import('./node-rules.js')
            .then(m => m.runQuietDigests?.({ now }))
            .catch(() => {});
    }
    if (runner === defaultRunner && now - lastMailRefreshAt >= 10 * 60_000) {
        lastMailRefreshAt = now;
        import('./node-rules.js')
            .then(m => m.runMailAutoRefresh?.({ now }))
            .catch(() => {});
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
    const sendToUser = (msg) => {
        const sessions = WORK?.constructor?.sessions || {};
        for (const s of Object.values(sessions)) {
            if (s?.uid === r.uid && typeof s.send === 'function') {
                try { s.send(msg); } catch { /* ignore */ }
            }
        }
    };
    const session = { uid: r.uid, $user: user, principal: Object.freeze({ kind: 'user', id: r.uid }), scheduled: true, sockets: {}, send: sendToUser };

    // Расписание уровня узла $structure (свежий запуск по поручению или на основе готовой задачи .task)
    if (r.node_path) {
        let nodeItem = await WORK.get_item(r.node_path).catch(() => null);
        if (Array.isArray(nodeItem))
            nodeItem = nodeItem.at(-1);
        if (!nodeItem)
            throw new Error('нет узла ' + r.node_path);
        const roles = await nodeItem.roles?.({ session }).catch(() => []);
        if (!roles.length)
            throw new Error('Доступ запрещён');
        let effectivePrompt = String(r.prompt || '').trim();
        if (r.task) {
            try {
                let tplFile = await WORK.get_item(r.task).catch(() => null);
                if (Array.isArray(tplFile)) tplFile = tplFile.at(-1);
                const raw = tplFile && typeof tplFile.load === 'function' ? await tplFile.load().catch(() => null) : null;
                const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
                const firstUser = Array.isArray(parsed?.items) ? parsed.items.find(i => i?.type === 'user' && i.content) : null;
                const basePrompt = String(firstUser?.content || '').trim();
                if (basePrompt) {
                    effectivePrompt = effectivePrompt && effectivePrompt !== basePrompt
                        ? `Выполни повторно по образцу задачи «${parsed?.title || r.label}»:\n${basePrompt}\n\nДополнительное уточнение: ${effectivePrompt}`
                        : basePrompt;
                }
            }
            catch { /* если исходная .task недоступна — используем сохранённый prompt */ }
        }
        const stamp = new Date().toLocaleString('ru-RU', { timeZone: r.tz || undefined });
        const { runOnce } = await import('./index.js');
        const res = await runOnce({
            place: nodeItem,
            session,
            prompt: '[по расписанию «' + r.label + '», ' + stamp + ']\n' + effectivePrompt,
            mode: 'ask',
            signal: AbortSignal.timeout(10 * 60_000),
        });
        const answer = String(res?.content || '').trim() || (res?.status === 'error' ? 'ошибка выполнения' : 'без результата');
        const CHAT = await import('../../server/chat-threads.js');
        await CHAT.sendMessage(nodeItem, {
            uid: r.uid,
            asTwin: true,
            kind: 'text',
            message: `🤖 Агент · по расписанию «${r.label}»:\n${answer}`,
            meta: { source: 'agent-schedule', scheduleId: r.id, scheduleLabel: r.label, actedAsBoss: true },
        }).catch(() => {});
        return;
    }

    let file = await WORK.get_item(r.task);
    if (Array.isArray(file))
        file = file.at(-1);
    if (!file || typeof file.prompt !== 'function') {
        await file?.init;
        if (!file || typeof file.prompt !== 'function')
            throw new Error('нет задачи ' + r.task);
    }
    // сессия владельца (внутренняя, без cookie): те же права, что при ручном сообщении;
    // события стрима пробрасываем во все живые WS-сессии владельца, чтобы открытый чат сразу видел ответ
    await file.assertAccess({ session }, 'read');
    const { getBody, idle } = await import('./session.js');
    const beforeBody = await getBody(file).catch(() => null);
    const prevCount = Array.isArray(beforeBody?.items) ? beforeBody.items.length : 0;
    const stamp = new Date().toLocaleString('ru-RU', { timeZone: r.tz || undefined });
    const res = await file.prompt({ session, prompt: '[по расписанию «' + r.label + '», ' + stamp + ']\n' + r.prompt });
    try {
        const finBody = !res?.queued ? await idle(file).catch(() => null) : null;
        const rawBody = finBody || (typeof file.load === 'function' ? await file.load().catch(() => null) : null);
        const parsed = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;
        const newItems = Array.isArray(parsed?.items) ? parsed.items.slice(prevCount) : [];
        const lastAssistant = [...newItems].reverse().find(i => i.type === 'assistant' && i.content && !i.error)
            || [...(parsed?.items || [])].reverse().find(i => i.type === 'assistant' && i.content && !i.error);
        const answer = String(lastAssistant?.content || res?.answer || r.prompt || '').trim();
        const { notifyScheduledRun } = await import('../notify/index.js');
        await notifyScheduledRun({ schedule: r, file, answer });
    }
    catch (e) {
        console.warn('[scheduler notify]', e.message);
    }
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
