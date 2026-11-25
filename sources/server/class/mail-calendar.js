/**
 * Серверное ядро Почты (.eml) и Календаря (.ics) для структурных узлов WORK ($server/$base/$project/$structure/$user).
 * Используется как UI-формами (form/email, form/calendar), так и инструментами ИИ-агента.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import * as LOGS from '../logs.js';
import { DEV_MODE } from '../../host/config.js';
import { parseEml, parseJsonEml } from '../../host/email-utils.js';

const ACCESS_DENIED = 'Доступ запрещён';

function parseJsonSafe(raw, fallback = null) {
    if (raw && typeof raw === 'object')
        return raw;
    if (typeof raw !== 'string' || !raw)
        return fallback;
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : fallback;
    }
    catch {
        return fallback;
    }
}

function parsePostBody(params = {}) {
    if (params.post && typeof params.post === 'object')
        return params.post;
    if (typeof params.post === 'string' && params.post.trim()) {
        return parseJsonSafe(params.post, {});
    }
    return params;
}

function resolveActorUid(storage, params = {}) {
    const uid = storage?.constructor?.resolveUid?.(params);
    if (uid)
        return uid;
    if (typeof params?.uid === 'string' && params.uid.trim() && (DEV_MODE || !params?.session || params.session.$user === globalThis.WORK))
        return params.uid.trim();
    if (params?.session?.$user === globalThis.WORK)
        return globalThis.WORK?.id || 'WORK';
    return '';
}

async function assertReadAccess(storage, params = {}) {
    if (!storage)
        throw new Error('Узел не задан');
    if (DEV_MODE || !params?.session || params.session.$user === globalThis.WORK)
        return { uid: resolveActorUid(storage, params), isBoss: true, roles: ['BOSS'] };
    const uid = resolveActorUid(storage, params);
    if (!uid)
        throw new Error(ACCESS_DENIED);
    if (storage.type === '$user') {
        if (storage.id !== uid)
            throw new Error(ACCESS_DENIED);
        return { uid, isBoss: true, roles: ['BOSS', 'USER'] };
    }
    const roles = await storage.roles?.(params).catch(() => []) || [];
    const isBoss = roles.includes('BOSS');
    const isUser = roles.includes('USER');
    const isClientOnly = roles.includes('CLIENT') && !isBoss && !isUser;
    if (isClientOnly)
        throw new Error(ACCESS_DENIED);
    const canSee = await storage.canSee?.(storage, params).catch(() => false);
    if (!isBoss && !isUser && !canSee)
        throw new Error(ACCESS_DENIED);
    return { uid, isBoss, roles };
}

async function assertWriteAccess(storage, params = {}) {
    const access = await assertReadAccess(storage, params);
    if (DEV_MODE || !params?.session || params.session.$user === globalThis.WORK)
        return access;
    if (storage.type === '$user')
        return access;
    const canWrite = access.isBoss || access.roles.includes('USER') || (await storage.canWrite?.(storage, params).catch(() => false));
    if (!canWrite)
        throw new Error(ACCESS_DENIED);
    return access;
}

async function loadRawEmlFile(filePath, params = {}) {
    if (!filePath)
        return '';
    try {
        const item = await globalThis.WORK?.get_item?.(filePath).catch(() => null);
        if (item?.load) {
            const txt = await item.load({ encoding: 'utf-8', session: params.session }).catch(() => '');
            if (txt) return String(txt);
        }
        if (item?.dir && fs.existsSync(item.dir))
            return fs.readFileSync(item.dir, 'utf-8');
    }
    catch { /* fallback */ }
    return '';
}

function parseEmlPayload(raw = '') {
    const json = parseJsonEml(raw);
    if (json && Object.keys(json).length && (json.box || json.subject || json.from || json.to || json.body != null || json.html != null))
        return { kind: 'json', data: json };
    const rfc = parseEml(raw);
    return {
        kind: 'rfc',
        data: {
            subject: rfc.headers.subject || '(без темы)',
            from: rfc.headers.from || '',
            to: rfc.headers.to || '',
            cc: rfc.headers.cc || '',
            date: rfc.headers.date || '',
            body: rfc.body || '',
            html: '',
            messageId: rfc.headers['message-id'] || '',
            box: 'inbox',
            read: true,
            attachments: [],
        },
    };
}

function buildMailSummary(row, meta, json = null) {
    const date = meta.date || json?.date || row.time || '';
    const sortTime = date ? new Date(date).getTime() : (Number(row.time) || 0);
    const box = meta.box || json?.box || 'inbox';
    const uid = meta.uid || json?.uid || '';
    return {
        path: row.path,
        logsFilePath: row.logsFilePath || '',
        uid,
        subject: meta.subject || json?.subject || '(без темы)',
        from: meta.from || json?.from || '',
        to: meta.to || json?.to || '',
        cc: meta.cc || json?.cc || '',
        date,
        sortTime: Number.isFinite(sortTime) ? sortTime : (Number(row.time) || 0),
        origTime: Number(row.time) || (Number.isFinite(sortTime) ? sortTime : Date.now()),
        status: meta.status || json?.status || '',
        error: meta.error || json?.error || '',
        box,
        prevBox: meta.prevBox || json?.prevBox || '',
        address: meta.mailbox || json?.mailbox || '',
        messageId: meta.messageId || json?.messageId || '',
        read: meta.read != null ? Boolean(meta.read) : (json?.read != null ? Boolean(json.read) : (box !== 'inbox')),
        attachmentsCount: Number(meta.attachmentsCount ?? json?.attachments?.length ?? 0) || 0,
        snippet: String(meta.snippet || json?.body || '').replace(/\s+/g, ' ').trim().slice(0, 140),
    };
}

function bareEmailAddress(v) {
    const s = String(v || '').trim();
    const m = s.match(/<([^>]+)>/);
    return (m ? m[1] : s).trim();
}

function validateEmailsList(raw, { required = false } = {}) {
    const list = String(raw || '').split(/[,;]/).map(s => s.trim()).filter(Boolean);
    if (!list.length) {
        if (required)
            throw new Error('Укажите получателя');
        return '';
    }
    const bad = list.filter(a => !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(bareEmailAddress(a)));
    if (bad.length)
        throw new Error('Некорректный адрес: ' + bad.join(', '));
    return list.join(', ');
}

function newUid() {
    return crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10));
}

async function readMailSettingsSafe(storage) {
    const { readEmailSettings } = await import('../../../$server/$folder/lib/email/settings.js');
    return readEmailSettings(storage);
}

/** Публичный список настроенных адресов узла (без паролей и секретов). */
export async function mailAccounts(storage, params = {}) {
    const access = await assertReadAccess(storage, params);
    const settings = await readMailSettingsSafe(storage);
    const accounts = [];
    for (const [key, box] of Object.entries(settings?.mailboxes || {})) {
        const address = String(box?.auth?.user || box?.address || key || '').trim();
        if (!address)
            continue;
        accounts.push({
            address,
            label: box?.label || address,
            hasImap: Boolean(box?.imap?.host),
            hasSmtp: Boolean(box?.smtp?.host),
        });
    }
    const canConfigure = DEV_MODE || !params?.session || access.isBoss || storage.type === '$user';
    return {
        accounts,
        canConfigure,
        autoRefresh: storage?.DATA?.mailAutoRefresh !== false,
    };
}

/** Единый плоский список писем узла с фильтрацией, поиском и счётчиками непрочитанных по папкам. */
export async function mailList(storage, params = {}) {
    await assertReadAccess(storage, params);
    const body = parsePostBody(params);
    const boxFilter = String(body.box || params.box || 'all').toLowerCase();
    const addressFilter = String(body.address || params.address || '').trim().toLowerCase();
    const q = String(body.q || params.q || '').trim().toLowerCase();
    const unreadOnly = body.unreadOnly === true || body.unreadOnly === '1' || params.unreadOnly === true || params.unreadOnly === '1';
    const limit = Math.max(1, Math.min(500, Number(body.limit || params.limit) || 200));

    const allDates = await LOGS.datesList(storage, { nonEmpty: 1, ext: 'eml', ...params }).catch(() => []);
    const dates = Array.isArray(allDates) ? allDates.slice(0, 120) : [];
    const rows = dates.length
        ? await LOGS.loadBodies(storage, { days: dates, ext: 'eml', ...params }).catch(() => [])
        : [];

    const seen = new Set();
    const items = [];
    for (const row of rows || []) {
        let meta = parseJsonSafe(row.content, null);
        let fullJson = null;
        if (!meta || (!meta.box && !meta.deleted)) {
            const raw = await loadRawEmlFile(row.path, params);
            if (!raw)
                continue;
            const parsed = parseEmlPayload(raw);
            fullJson = parsed.data;
            meta = parsed.data;
        }
        const key = meta.uid ? `uid:${meta.uid}` : `path:${row.path}`;
        if (seen.has(key))
            continue;
        seen.add(key);

        if (meta.deleted === true || meta.box === 'deleted')
            continue;
        items.push(buildMailSummary(row, meta, fullJson));
    }

    items.sort((a, b) => (b.sortTime || 0) - (a.sortTime || 0));

    const countsByBox = { inbox: 0, drafts: 0, outbox: 0, trash: 0 };
    const unreadByBox = { inbox: 0, drafts: 0, outbox: 0, trash: 0 };
    for (const it of items) {
        if (addressFilter && String(it.address || '').toLowerCase() !== addressFilter)
            continue;
        const b = countsByBox[it.box] !== undefined ? it.box : 'inbox';
        countsByBox[b]++;
        if (!it.read)
            unreadByBox[b]++;
    }

    const filtered = items.filter(it => {
        if (boxFilter !== 'all' && it.box !== boxFilter)
            return false;
        if (addressFilter && String(it.address || '').toLowerCase() !== addressFilter)
            return false;
        if (unreadOnly && it.read)
            return false;
        if (q) {
            const hay = `${it.subject}\n${it.from}\n${it.to}\n${it.cc}\n${it.snippet}`.toLowerCase();
            if (!hay.includes(q))
                return false;
        }
        return true;
    }).slice(0, limit);

    return {
        messages: filtered,
        countsByBox,
        unreadByBox,
        total: filtered.length,
    };
}

async function resolveEmlByTarget(storage, params = {}) {
    const body = parsePostBody(params);
    const targetPath = String(body.path || params.path || '').trim();
    const targetUid = String(body.uid || params.uid || '').trim();
    if (targetPath) {
        const listRes = await mailList(storage, { ...params, box: 'all', limit: 500 });
        const found = listRes.messages.find(m => m.path === targetPath || (targetUid && m.uid === targetUid));
        return { summary: found, path: found?.path || targetPath };
    }
    if (targetUid) {
        const listRes = await mailList(storage, { ...params, box: 'all', limit: 500 });
        const found = listRes.messages.find(m => m.uid === targetUid);
        if (found)
            return { summary: found, path: found.path };
    }
    return { summary: null, path: '' };
}

/** Прочитать полное письмо (.eml) и при необходимости отметить прочитанным. */
export async function mailRead(storage, params = {}) {
    await assertReadAccess(storage, params);
    const body = parsePostBody(params);
    const { summary, path: filePath } = await resolveEmlByTarget(storage, params);
    if (!filePath)
        throw new Error('Письмо не найдено');

    const raw = await loadRawEmlFile(filePath, params);
    if (!raw)
        throw new Error('Не удалось прочитать файл письма');

    const parsed = parseEmlPayload(raw);
    const d = parsed.data || {};
    const msg = {
        path: filePath,
        uid: summary?.uid || d.uid || '',
        subject: d.subject || summary?.subject || '(без темы)',
        from: d.from || summary?.from || '',
        to: d.to || summary?.to || '',
        cc: d.cc || summary?.cc || '',
        date: d.date || summary?.date || '',
        sortTime: summary?.sortTime || (d.date ? new Date(d.date).getTime() : Date.now()),
        origTime: summary?.origTime || (d.date ? new Date(d.date).getTime() : Date.now()),
        body: d.body ?? '',
        html: d.html ?? '',
        box: summary?.box || d.box || 'inbox',
        prevBox: summary?.prevBox || d.prevBox || '',
        address: summary?.address || d.mailbox || '',
        status: summary?.status || d.status || '',
        error: summary?.error || d.error || '',
        messageId: d.messageId || summary?.messageId || '',
        read: summary ? summary.read : (d.read !== false),
        attachments: Array.isArray(d.attachments) ? d.attachments : [],
    };

    const wantMarkRead = body.markRead !== false && params.markRead !== false;
    if (wantMarkRead && !msg.read && msg.box === 'inbox') {
        try {
            await mailState(storage, { ...params, path: filePath, uid: msg.uid, read: true });
            msg.read = true;
        }
        catch { /* read-only user still reads */ }
    }
    return msg;
}

/** Сохранить или обновить черновик письма в папке drafts. */
export async function mailDraftSave(storage, params = {}) {
    await assertWriteAccess(storage, params);
    const body = parsePostBody(params);
    const { accounts } = await mailAccounts(storage, params);
    const address = String(body.from || body.mailbox || accounts[0]?.address || 'drafts').trim();
    const uid = String(body.uid || newUid()).trim();
    const nowIso = new Date().toISOString();
    const nowMs = Number(body.origTime) || Date.now();
    const attachments = Array.isArray(body.attachments) ? body.attachments : [];

    const json = {
        uid,
        subject: String(body.subject || '').trim() || '(без темы)',
        from: String(body.from || address),
        to: String(body.to || '').trim(),
        cc: String(body.cc || '').trim(),
        date: nowIso,
        body: String(body.body || ''),
        html: String(body.html || ''),
        inReplyTo: String(body.inReplyTo || ''),
        status: 'draft',
        box: 'drafts',
        mailbox: address,
        read: true,
        attachments,
    };

    const meta = {
        uid,
        subject: json.subject,
        from: json.from,
        to: json.to,
        cc: json.cc,
        date: nowIso,
        box: 'drafts',
        mailbox: address,
        status: 'draft',
        read: true,
        attachmentsCount: attachments.length,
        snippet: json.body.slice(0, 140),
    };

    const saved = await storage.save_file({
        filename: `draft-${uid}.eml`,
        folder: address || 'drafts',
        encoding: 'utf-8',
        time: nowMs,
        feed: 'point',
        message: JSON.stringify(meta),
        post: JSON.stringify(json),
        session: params.session,
    });
    return {
        ok: true,
        uid,
        path: saved?.path || '',
        message: { ...meta, path: saved?.path || '', origTime: nowMs, sortTime: Date.parse(nowIso) },
    };
}

/** Отправить письмо через штатный SMTP-конвейер (outbound.eml -> $eml/on_save). */
export async function mailSend(storage, params = {}) {
    await assertWriteAccess(storage, params);
    const body = parsePostBody(params);
    const { accounts } = await mailAccounts(storage, params);
    const address = String(body.from || body.mailbox || accounts[0]?.address || '').trim();
    if (!address)
        throw new Error('Сначала настройте почтовый ящик');

    const to = validateEmailsList(body.to, { required: true });
    const cc = validateEmailsList(body.cc, { required: false });
    const uid = String(body.draftUid || body.uid || newUid()).trim();
    const nowIso = new Date().toISOString();
    const attachments = Array.isArray(body.attachments) ? body.attachments : [];

    const eml = {
        uid,
        subject: String(body.subject || '').trim() || '(без темы)',
        from: address,
        to,
        ...(cc ? { cc } : {}),
        date: nowIso,
        body: String(body.body || ''),
        html: String(body.html || ''),
        ...(body.inReplyTo ? { inReplyTo: String(body.inReplyTo) } : {}),
        status: 'pending',
        box: 'outbox',
        mailbox: address,
        read: true,
        attachments,
    };

    const meta = {
        uid,
        subject: eml.subject,
        from: eml.from,
        to: eml.to,
        cc: eml.cc || '',
        date: nowIso,
        box: 'outbox',
        mailbox: address,
        status: 'pending',
        read: true,
        attachmentsCount: attachments.length,
        snippet: eml.body.slice(0, 140),
    };

    const saved = await storage.save_file({
        filename: 'outbound.eml',
        folder: address,
        encoding: 'utf-8',
        feed: 'point',
        message: JSON.stringify(meta),
        post: JSON.stringify(eml),
        session: params.session,
    });

    return { ok: true, uid, path: saved?.path || '', status: 'sent_queued' };
}

/** Изменить статус письма: read/unread, в корзину, восстановить, удалить навсегда. */
export async function mailState(storage, params = {}) {
    await assertWriteAccess(storage, params);
    const body = parsePostBody(params);
    const { summary, path: filePath } = await resolveEmlByTarget(storage, params);
    if (!filePath)
        throw new Error('Письмо не найдено');

    const raw = await loadRawEmlFile(filePath, params);
    if (!raw)
        throw new Error('Файл письма не найден');

    const parsed = parseEmlPayload(raw);
    const json = { ...(parsed.data || {}) };
    const uid = summary?.uid || json.uid || newUid();
    json.uid = uid;
    const origTime = summary?.origTime || (json.date ? new Date(json.date).getTime() : Date.now());
    const curBox = summary?.box || json.box || 'inbox';

    if (typeof body.read === 'boolean')
        json.read = body.read;

    if (body.deletePermanent) {
        json.box = 'deleted';
        json.deleted = true;
    }
    else if (body.restore) {
        json.box = summary?.prevBox || json.prevBox || 'inbox';
        delete json.prevBox;
        delete json.deleted;
    }
    else if (body.box && body.box !== curBox) {
        if (body.box === 'trash' && curBox !== 'trash')
            json.prevBox = curBox;
        json.box = String(body.box);
        delete json.deleted;
    }

    const meta = {
        uid,
        subject: json.subject || summary?.subject || '(без темы)',
        from: json.from || summary?.from || '',
        to: json.to || summary?.to || '',
        cc: json.cc || summary?.cc || '',
        date: json.date || summary?.date || new Date(origTime).toISOString(),
        box: json.box || curBox,
        ...(json.prevBox ? { prevBox: json.prevBox } : {}),
        ...(json.deleted ? { deleted: true } : {}),
        mailbox: json.mailbox || summary?.address || '',
        status: json.status || summary?.status || '',
        ...(json.error ? { error: json.error } : {}),
        read: json.read !== false,
        messageId: json.messageId || summary?.messageId || '',
        attachmentsCount: Array.isArray(json.attachments) ? json.attachments.length : (summary?.attachmentsCount || 0),
        snippet: String(json.body || '').replace(/\s+/g, ' ').trim().slice(0, 140),
    };

    await storage.save_file({
        filename: `state-${uid}.eml`,
        folder: meta.mailbox || 'mail',
        encoding: 'utf-8',
        time: origTime,
        feed: 'point',
        message: JSON.stringify(meta),
        post: JSON.stringify(json),
        session: params.session,
    });

    return { ok: true, uid, box: meta.box, read: meta.read, deleted: Boolean(json.deleted) };
}

/** Запросить свежие входящие письма с IMAP-сервера узла. */
export async function mailRefresh(storage, params = {}) {
    await assertWriteAccess(storage, params);
    const handler = await storage.get_item?.('/~/handlers/pages/form/email/$handler/methods/refresh/$method').catch(() => null);
    if (handler && typeof handler.execute === 'function')
        return handler.execute(params);
    const mod = await import('../../../$server/$folder/$class/$structure/handlers/pages/form/email/$handler/methods/refresh/$method/class.js');
    return mod.default.execute.call({ $context: { $context: storage } }, params);
}

// ==================== Календарь (.ics + задачи + расписания ИИ) ====================

function addStepByRecurrence(date, recurrence) {
    const d = new Date(date.getTime());
    switch (recurrence) {
        case 'daily': d.setDate(d.getDate() + 1); break;
        case 'weekly': d.setDate(d.getDate() + 7); break;
        case 'monthly': d.setMonth(d.getMonth() + 1); break;
        case 'yearly': d.setFullYear(d.getFullYear() + 1); break;
        default: return null;
    }
    return d;
}

function expandCalendarEvent(ev, fromMs, toMs) {
    const startMs = Date.parse(ev.start);
    const endMs = Date.parse(ev.end);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs)
        return [];
    const dur = endMs - startMs;
    const rec = String(ev.recurrence || 'none').toLowerCase();
    if (!rec || rec === 'none') {
        if (endMs > fromMs && startMs <= toMs)
            return [{ ...ev, isOccurrence: false }];
        return [];
    }
    const untilMs = ev.recurrenceUntil ? Date.parse(ev.recurrenceUntil) : toMs;
    const hardLimit = Math.min(toMs, Number.isFinite(untilMs) ? untilMs : toMs);
    const out = [];
    let cur = new Date(startMs);
    for (let guard = 0; guard < 400; guard++) {
        const s = cur.getTime();
        const e = s + dur;
        if (s > hardLimit)
            break;
        if (e > fromMs && s <= toMs) {
            out.push({
                ...ev,
                start: new Date(s).toISOTimezoneString?.() || new Date(s).toISOString(),
                end: new Date(e).toISOTimezoneString?.() || new Date(e).toISOString(),
                masterStart: ev.start,
                masterEnd: ev.end,
                isOccurrence: s !== startMs,
            });
        }
        const next = addStepByRecurrence(cur, rec);
        if (!next || next.getTime() <= cur.getTime())
            break;
        cur = next;
    }
    return out;
}

function formatDayLocal(ms) {
    const d = new Date(ms);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function computeFreeSlots(events, fromDay, toDay) {
    const slots = [];
    const cur = new Date(`${fromDay}T00:00:00`);
    const end = new Date(`${toDay}T00:00:00`);
    for (let guard = 0; guard < 31 && cur <= end; guard++) {
        const dayStr = formatDayLocal(cur.getTime());
        const workStart = new Date(`${dayStr}T09:00:00`).getTime();
        const workEnd = new Date(`${dayStr}T18:00:00`).getTime();
        const busy = [];
        for (const ev of events) {
            if (ev.kind === 'schedule')
                continue;
            const s = Date.parse(ev.start);
            const e = Date.parse(ev.end);
            if (!Number.isFinite(s) || !Number.isFinite(e) || e <= workStart || s >= workEnd)
                continue;
            busy.push([Math.max(workStart, s), Math.min(workEnd, e)]);
        }
        busy.sort((a, b) => a[0] - b[0]);
        let cursor = workStart;
        const dayFree = [];
        for (const [bs, be] of busy) {
            if (bs > cursor)
                dayFree.push({ start: new Date(cursor).toISOString(), end: new Date(bs).toISOString(), minutes: Math.round((bs - cursor) / 60000) });
            cursor = Math.max(cursor, be);
        }
        if (cursor < workEnd)
            dayFree.push({ start: new Date(cursor).toISOString(), end: new Date(workEnd).toISOString(), minutes: Math.round((workEnd - cursor) / 60000) });
        slots.push({ day: dayStr, free: dayFree.filter(s => s.minutes >= 15) });
        cur.setDate(cur.getDate() + 1);
    }
    return slots;
}

/** Список событий календаря (с развёрнутыми повторениями), плюс опционально задачи и расписания ИИ. */
export async function calendarList(storage, params = {}) {
    const access = await assertReadAccess(storage, params);
    const body = parsePostBody(params);
    const todayStr = formatDayLocal(Date.now());
    const fromDay = String(body.from || params.from || todayStr).slice(0, 10);
    const toDay = String(body.to || params.to || fromDay).slice(0, 10);
    const fromMs = Date.parse(`${fromDay}T00:00:00`);
    const toMs = Date.parse(`${toDay}T23:59:59.999`);
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs))
        throw new Error('Некорректный диапазон дат from/to');

    const includeTasks = body.includeTasks === true || body.includeTasks === '1' || params.includeTasks === true || params.includeTasks === '1';
    const includeSchedules = body.includeSchedules === true || body.includeSchedules === '1' || params.includeSchedules === true || params.includeSchedules === '1';
    const withFreeSlots = body.withFreeSlots === true || body.withFreeSlots === '1' || params.withFreeSlots === true || params.withFreeSlots === '1';
    const attendeeFilter = Array.isArray(body.attendees) ? body.attendees : (typeof body.attendee === 'string' && body.attendee ? [body.attendee] : []);

    const allDates = await LOGS.datesList(storage, { nonEmpty: 1, ext: 'ics', ...params }).catch(() => []);
    const icsRows = allDates?.length
        ? await LOGS.loadBodies(storage, { days: allDates, ext: 'ics', ...params }).catch(() => [])
        : [];

    const latest = new Map();
    for (const row of icsRows || []) {
        const content = parseJsonSafe(row.content, null);
        if (!content)
            continue;
        const key = content.uid ? String(content.uid) : `path:${row.path}`;
        if (!latest.has(key))
            latest.set(key, { row, content });
    }

    const events = [];
    for (const { row, content } of latest.values()) {
        if (content.status === 'cancelled' || !content.start || !content.end)
            continue;
        const attendees = Array.isArray(content.attendees) ? content.attendees : [];
        const organizer = content.organizer || row.sender || '';
        // Права просмотра в отделе: BOSS видит всё; USER — свои, где он участник, или общие без списка участников
        if (!access.isBoss && storage.type !== '$user') {
            const visible = organizer === access.uid
                || attendees.includes(access.uid)
                || attendees.length === 0;
            if (!visible)
                continue;
        }
        if (attendeeFilter.length) {
            const hit = attendeeFilter.some(u => u === organizer || attendees.includes(u));
            if (!hit)
                continue;
        }
        const baseEvent = {
            kind: 'event',
            uid: content.uid || `file:${row.path}`,
            summary: content.summary ?? '',
            location: content.location ?? '',
            description: content.description ?? '',
            start: content.start,
            end: content.end,
            allDay: Boolean(content.allDay),
            attendees,
            externalEmails: Array.isArray(content.externalEmails) ? content.externalEmails : [],
            recurrence: content.recurrence || 'none',
            reminderMin: Number(content.reminderMin) || 0,
            category: content.category || 'meeting',
            organizer,
            sourceNodePath: content.sourceNodePath || '',
            path: row.path,
            logsFilePath: row.logsFilePath || '',
            row,
        };
        events.push(...expandCalendarEvent(baseEvent, fromMs, toMs));
    }

    if (includeTasks) {
        const taskRows = await LOGS.loadBodies(storage, { from: fromDay, to: toDay, ext: 'task', ...params }).catch(() => []);
        const seenTasks = new Set();
        for (const row of taskRows || []) {
            if (!row?.path || seenTasks.has(row.path))
                continue;
            seenTasks.add(row.path);
            if (!access.isBoss && storage.type !== '$user' && row.sender !== access.uid && !(Array.isArray(row.receivers) && row.receivers.includes(access.uid)))
                continue;
            const tMs = Number(row.time) || Date.now();
            const startIso = new Date(tMs).toISOString();
            const endIso = new Date(tMs + 30 * 60_000).toISOString();
            events.push({
                kind: 'task',
                uid: `task:${row.path}`,
                summary: String(row.content || 'Задача').slice(0, 120),
                start: startIso,
                end: endIso,
                allDay: false,
                category: 'task',
                path: row.path,
                organizer: row.sender || '',
                attendees: Array.isArray(row.receivers) ? row.receivers : [],
            });
        }
    }

    if (includeSchedules) {
        try {
            const { listSchedules } = await import('../../modules/agent/scheduler.js');
            const nodePath = LOGS.feedPathOf(storage);
            const scheds = await listSchedules({ nodePath }).catch(() => []);
            for (const s of scheds) {
                if (!s.enabled || !s.next)
                    continue;
                const nextMs = Number(s.next);
                if (nextMs >= fromMs && nextMs <= toMs) {
                    events.push({
                        kind: 'schedule',
                        uid: `sched:${s.id}`,
                        summary: s.label || 'Расписание ИИ',
                        description: s.prompt || '',
                        start: new Date(nextMs).toISOString(),
                        end: new Date(nextMs + 30 * 60_000).toISOString(),
                        allDay: false,
                        category: 'ai',
                        scheduleId: s.id,
                    });
                }
            }
        }
        catch { /* ignore */ }
    }

    events.sort((a, b) => String(a.start).localeCompare(String(b.start)));

    return {
        from: fromDay,
        to: toDay,
        events,
        ...(withFreeSlots ? { freeSlots: computeFreeSlots(events, fromDay, toDay) } : {}),
    };
}

/** Создать, обновить, перенести или отменить событие календаря (.ics) + синхронизация участникам в /USERS/<uid>. */
export async function calendarSave(storage, params = {}) {
    const access = await assertWriteAccess(storage, params);
    const body = parsePostBody(params);
    const uid = String(body.uid || newUid()).trim();
    const status = body.status === 'cancelled' ? 'cancelled' : 'confirmed';
    const start = String(body.start || '').trim();
    const end = String(body.end || '').trim();
    if (!start || !end)
        throw new Error('Укажите дату начала и окончания события');
    const startMs = Date.parse(start);
    const endMs = Date.parse(end);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs)
        throw new Error('Время окончания должно быть позже времени начала');

    const attendees = [...new Set((Array.isArray(body.attendees) ? body.attendees : []).map(s => String(s || '').trim()).filter(Boolean))];
    const externalEmails = [...new Set((Array.isArray(body.externalEmails) ? body.externalEmails : []).map(s => String(s || '').trim()).filter(Boolean))];

    const payload = {
        uid,
        summary: String(body.summary || 'Встреча').trim(),
        location: String(body.location || '').trim(),
        description: String(body.description || '').trim(),
        start,
        end,
        allDay: Boolean(body.allDay),
        attendees,
        externalEmails,
        recurrence: String(body.recurrence || 'none').trim(),
        reminderMin: Number(body.reminderMin) || 0,
        category: String(body.category || 'meeting').trim(),
        organizer: String(body.organizer || access.uid || '').trim(),
        sourceNodePath: String(body.sourceNodePath || storage.path || '/'),
        status,
        time: startMs,
    };

    const msg = {
        uid,
        summary: payload.summary,
        location: payload.location,
        description: payload.description,
        start: payload.start,
        end: payload.end,
        allDay: payload.allDay,
        attendees: payload.attendees,
        externalEmails: payload.externalEmails,
        recurrence: payload.recurrence,
        reminderMin: payload.reminderMin,
        category: payload.category,
        organizer: payload.organizer,
        sourceNodePath: payload.sourceNodePath,
        status: payload.status,
        time: payload.time,
    };

    const saved = await storage.save_file({
        filename: `${uid}.ics`,
        encoding: 'utf-8',
        time: startMs,
        feed: 'point',
        message: JSON.stringify(msg),
        post: JSON.stringify(payload),
        session: params.session,
    });

    // Зеркалируем приглашение в личные календари приглашённых сотрудников (/USERS/<attUid>)
    const mirrored = [];
    if (attendees.length && globalThis.WORK?.$users) {
        const usersRoot = await globalThis.WORK.$users;
        for (const attUid of attendees) {
            if (storage.type === '$user' && storage.id === attUid)
                continue;
            const userCab = await usersRoot.get_item?.('//' + attUid).catch(() => null);
            if (!userCab || typeof userCab.save_file !== 'function')
                continue;
            await userCab.save_file({
                filename: `${uid}.ics`,
                encoding: 'utf-8',
                time: startMs,
                feed: 'point',
                message: JSON.stringify(msg),
                post: JSON.stringify(payload),
                // системное зеркало приглашения в личный календарь приглашённого
                session: { uid: attUid, $user: globalThis.WORK },
            }).catch(() => {});
            mirrored.push(attUid);
        }
    }

    return { ok: true, uid, path: saved?.path || '', event: payload, mirrored };
}
