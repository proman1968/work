/**
 * Серверный модуль службы поддержки и встроенного Remote Desktop в WORK (sources/modules/support/index.js).
 *
 * Связывает локальный сервер WORK с work.odant.org через приватные методы сервера:
 *  - подписывает обращения из #system/owner-token.json и #system/license.json (не раскрывая их браузеру);
 *  - работает как для лицензированных серверов (SLA), так и для гостевых/пробных установок;
 *  - изолирует тикеты по автору (USER видит только свои, BOSS корня — все по серверу);
 *  - проксирует медиавложения и сигналинг/кадры Remote Desktop, исключая проблемы CORS в ЛВС.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DEV_MODE } from '../../host/config.js';
import { getVersionStatus } from '../../host/auto-updater.js';
import {
    DEFAULT_LICENSE_HUB_URL,
    loadOwnerTokenBinding,
    loadLocalLicense,
    getHardwareIdentity,
} from '../license/index.js';

const SYSTEM_DIR = './#system';
const SUPPORT_STORE_FILE = 'support-tickets.json';

function parseBody(params = {}) {
    if (params.post && typeof params.post === 'string') {
        try { return JSON.parse(params.post); }
        catch { return {}; }
    }
    if (params.post && typeof params.post === 'object')
        return params.post;
    return params;
}

function resolveSystemDir(storage) {
    const rootDir = path.resolve(storage?.dir || process.cwd());
    return path.join(rootDir, '#system');
}

function readLocalTicketsStore(systemDir = SYSTEM_DIR) {
    const file = path.join(systemDir, SUPPORT_STORE_FILE);
    try {
        if (fs.existsSync(file)) {
            const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
            if (raw && Array.isArray(raw.tickets))
                return raw;
        }
    }
    catch { /* ignore */ }
    return { tickets: [] };
}

function writeLocalTicketsStore(systemDir = SYSTEM_DIR, storeObj = { tickets: [] }) {
    fs.mkdirSync(systemDir, { recursive: true });
    const file = path.join(systemDir, SUPPORT_STORE_FILE);
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(storeObj, null, 2), 'utf8');
    fs.renameSync(tmp, file);
    return storeObj;
}

function resolveHubUrl(systemDir = SYSTEM_DIR, override = '') {
    if (override)
        return String(override).replace(/\/+$/, '');
    if (process.env.WORK_SUPPORT_HUB_URL)
        return String(process.env.WORK_SUPPORT_HUB_URL).replace(/\/+$/, '');
    const binding = loadOwnerTokenBinding(systemDir);
    if (binding?.hubUrl)
        return String(binding.hubUrl).replace(/\/+$/, '');
    const lic = loadLocalLicense(undefined, { systemDir });
    if (lic?.hubUrl)
        return String(lic.hubUrl).replace(/\/+$/, '');
    return String(DEFAULT_LICENSE_HUB_URL).replace(/\/+$/, '');
}

async function resolveUserContext(storage, params = {}) {
    const uid = storage?.constructor?.resolveUid?.(params) || '';
    if (!uid)
        throw new Error('Требуется вход в систему WORK');
    const roles = typeof storage?.roles === 'function'
        ? await storage.roles(params).catch(() => [])
        : [];
    const isBoss = Boolean(DEV_MODE || roles.includes('BOSS'));

    let userName = uid;
    let userEmail = '';
    try {
        const uItem = await globalThis.WORK?.get_item?.(`/USERS/${uid}`).catch(() => null);
        if (uItem) {
            await uItem.init?.catch?.(() => {});
            userName = uItem.DATA?.label || uItem.label || uid;
            userEmail = uItem.DATA?.email || '';
        }
    }
    catch { /* ignore */ }
    return { uid, isBoss, userName: String(userName || uid), userEmail: String(userEmail || '') };
}

export async function createSupportTicketFromWork(storage, params = {}, { fetchImpl = globalThis.fetch } = {}) {
    const { uid, userName, userEmail } = await resolveUserContext(storage, params);
    const body = parseBody(params);
    const text = String(body.text || '').trim();
    const attachments = Array.isArray(body.attachments) ? body.attachments : [];
    if (!text && !attachments.length)
        throw new Error('Опишите проблему или приложите скриншот / видео');

    const rootDir = path.resolve(storage?.dir || process.cwd());
    const systemDir = path.join(rootDir, '#system');
    const hubUrl = resolveHubUrl(systemDir, body.hubUrl);
    const binding = loadOwnerTokenBinding(systemDir);
    const lic = loadLocalLicense(undefined, { systemDir });
    const hw = getHardwareIdentity();
    const ver = getVersionStatus({ rootDir });

    const techContext = body.includeTech !== false
        ? {
            ...(body.techContext && typeof body.techContext === 'object' ? body.techContext : {}),
            version: ver.runningVersion,
            diskVersion: ver.diskVersion,
            serverId: hw.serverId,
            hwid: hw.hwid,
        }
        : null;

    const payload = {
        ownerToken: binding?.token || '',
        licenseId: lic?.unlicensed ? '' : (lic?.licenseId || ''),
        serverId: hw.serverId,
        serverName: storage?.DATA?.label || storage?.label || 'WORK',
        customerName: lic?.customer?.name || binding?.email || storage?.DATA?.label || 'Сервер WORK',
        userId: uid,
        userName: body.userName || userName,
        userEmail: body.userEmail || userEmail || binding?.email || '',
        text: text || 'Скриншот / запись проблемы без текстового описания',
        techContext,
        attachments,
    };

    const res = await fetchImpl(`${hubUrl}/api/support/tickets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ticket)
        throw new Error(data.error || `Сервер поддержки ответил HTTP ${res.status}`);

    const ticket = data.ticket;
    const accessKey = String(ticket.ticketAccessKey || '');
    const sanitized = { ...ticket };
    delete sanitized.ticketAccessKey;

    const store = readLocalTicketsStore(systemDir);
    const now = Date.now();
    store.tickets.unshift({
        ticketId: sanitized.ticketId,
        ticketAccessKey: accessKey,
        hubUrl,
        createdByUid: uid,
        createdByName: payload.userName,
        createdAt: sanitized.createdAt || now,
        lastReadByUid: { [uid]: now },
        cached: sanitized,
    });
    writeLocalTicketsStore(systemDir, store);

    return {
        ok: true,
        ticket: { ...sanitized, unreadCount: 0, own: true },
    };
}

export async function listSupportTicketsForWork(storage, params = {}, { fetchImpl = globalThis.fetch } = {}) {
    const { uid, isBoss } = await resolveUserContext(storage, params);
    const rootDir = path.resolve(storage?.dir || process.cwd());
    const systemDir = path.join(rootDir, '#system');
    const defaultHubUrl = resolveHubUrl(systemDir);
    const store = readLocalTicketsStore(systemDir);

    const visibleRecs = store.tickets.filter(rec => rec && (isBoss || rec.createdByUid === uid));
    if (!visibleRecs.length) {
        return { ok: true, tickets: [], unreadTotal: 0, remoteRequests: 0, isBoss, hubUrl: defaultHubUrl };
    }

    // Группируем по hubUrl и синхронизируем свежие статусы/сообщения с work.odant.org
    const byHub = new Map();
    for (const rec of visibleRecs) {
        const u = String(rec.hubUrl || defaultHubUrl).replace(/\/+$/, '');
        if (!byHub.has(u)) byHub.set(u, []);
        byHub.get(u).push(rec);
    }

    let syncError = '';
    const syncedById = new Map();
    for (const [hubUrl, recs] of byHub.entries()) {
        try {
            const res = await fetchImpl(`${hubUrl}/api/support/tickets/sync`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tickets: recs.map(r => ({ ticketId: r.ticketId, ticketAccessKey: r.ticketAccessKey })),
                }),
                signal: AbortSignal.timeout(8000),
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok && Array.isArray(data.tickets)) {
                for (const t of data.tickets) {
                    if (t?.ticketId) syncedById.set(t.ticketId, t);
                }
            }
            else if (!res.ok) {
                syncError = data.error || `HTTP ${res.status}`;
            }
        }
        catch (err) {
            syncError = String(err?.message || err);
        }
    }

    let changed = false;
    let unreadTotal = 0;
    let remoteRequests = 0;
    const tickets = [];

    for (const rec of visibleRecs) {
        const fresh = syncedById.get(rec.ticketId);
        if (fresh) {
            rec.cached = fresh;
            changed = true;
        }
        const t = fresh || rec.cached || { ticketId: rec.ticketId, status: 'open', messages: [] };
        const lastRead = Number(rec.lastReadByUid?.[uid] || 0);
        const unreadCount = (t.messages || []).filter(m =>
            (m.from === 'support' || m.role === 'engineer') && Number(m.time || 0) > lastRead
        ).length;
        unreadTotal += unreadCount;
        if (t.remote?.state === 'requested')
            remoteRequests++;
        tickets.push({
            ...t,
            unreadCount,
            own: rec.createdByUid === uid,
            createdByUid: rec.createdByUid,
            createdByName: rec.createdByName || t.userName || rec.createdByUid,
        });
    }

    if (changed)
        writeLocalTicketsStore(systemDir, store);

    tickets.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    return {
        ok: true,
        tickets,
        unreadTotal,
        remoteRequests,
        isBoss,
        hubUrl: defaultHubUrl,
        ...(syncError ? { syncError } : {}),
    };
}

function findAuthorizedRecord(systemDir, ticketId, uid, isBoss) {
    const store = readLocalTicketsStore(systemDir);
    const rec = store.tickets.find(r => r?.ticketId === ticketId);
    if (!rec)
        throw new Error('Обращение не найдено на этом сервере');
    if (!isBoss && rec.createdByUid !== uid)
        throw new Error('Нет доступа к чужому обращению');
    return { store, rec };
}

export async function replySupportTicketFromWork(storage, params = {}, { fetchImpl = globalThis.fetch } = {}) {
    const { uid, isBoss, userName } = await resolveUserContext(storage, params);
    const body = parseBody(params);
    const ticketId = String(body.ticketId || params.ticketId || '').trim();
    const text = String(body.text || '').trim();
    const attachments = Array.isArray(body.attachments) ? body.attachments : [];
    if (!ticketId)
        throw new Error('Не указан номер обращения');
    if (!text && !attachments.length)
        throw new Error('Введите сообщение или приложите файл');

    const systemDir = resolveSystemDir(storage);
    const { store, rec } = findAuthorizedRecord(systemDir, ticketId, uid, isBoss);
    const hubUrl = resolveHubUrl(systemDir, rec.hubUrl);

    const res = await fetchImpl(`${hubUrl}/api/support/tickets/${encodeURIComponent(ticketId)}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            ticketAccessKey: rec.ticketAccessKey,
            author: userName,
            userId: uid,
            text,
            attachments,
        }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ticket)
        throw new Error(data.error || `Ошибка отправки сообщения (HTTP ${res.status})`);

    rec.cached = data.ticket;
    rec.lastReadByUid ??= {};
    rec.lastReadByUid[uid] = Date.now();
    writeLocalTicketsStore(systemDir, store);
    return { ok: true, ticket: { ...data.ticket, unreadCount: 0, own: rec.createdByUid === uid } };
}

export async function markSupportTicketRead(storage, params = {}) {
    const { uid, isBoss } = await resolveUserContext(storage, params);
    const body = parseBody(params);
    const ticketId = String(body.ticketId || params.ticketId || '').trim();
    const systemDir = resolveSystemDir(storage);
    const store = readLocalTicketsStore(systemDir);
    const now = Date.now();
    let changed = false;
    for (const rec of store.tickets) {
        if (!rec) continue;
        if (!isBoss && rec.createdByUid !== uid) continue;
        if (!ticketId || rec.ticketId === ticketId) {
            rec.lastReadByUid ??= {};
            rec.lastReadByUid[uid] = now;
            changed = true;
        }
    }
    if (changed)
        writeLocalTicketsStore(systemDir, store);
    return { ok: true };
}

export async function fetchSupportMediaFromWork(storage, params = {}, { fetchImpl = globalThis.fetch } = {}) {
    const { uid, isBoss } = await resolveUserContext(storage, params);
    const ticketId = String(params.ticketId || '').trim();
    const file = path.basename(String(params.file || '').trim());
    if (!ticketId || !file)
        throw new Error('Не указаны параметры медиафайла');
    const systemDir = resolveSystemDir(storage);
    const { rec } = findAuthorizedRecord(systemDir, ticketId, uid, isBoss);
    const hubUrl = resolveHubUrl(systemDir, rec.hubUrl);
    const url = `${hubUrl}/api/support/media/${encodeURIComponent(ticketId)}/${encodeURIComponent(file)}?key=${encodeURIComponent(rec.ticketAccessKey)}`;
    const res = await fetchImpl(url);
    if (!res.ok)
        throw new Error(`Не удалось загрузить вложение (HTTP ${res.status})`);
    const mime = res.headers.get('content-type') || 'application/octet-stream';
    const buf = Buffer.from(await res.arrayBuffer());
    return {
        ok: true,
        mime,
        dataUrl: `data:${mime};base64,${buf.toString('base64')}`,
    };
}

export async function relaySupportRemoteFromWork(storage, params = {}, { fetchImpl = globalThis.fetch } = {}) {
    const { uid, isBoss } = await resolveUserContext(storage, params);
    const body = parseBody(params);
    const ticketId = String(body.ticketId || params.ticketId || '').trim();
    if (!ticketId)
        throw new Error('Не указан номер обращения');
    const systemDir = resolveSystemDir(storage);
    const { rec } = findAuthorizedRecord(systemDir, ticketId, uid, isBoss);
    const hubUrl = resolveHubUrl(systemDir, rec.hubUrl);

    const payload = { ...body, ticketAccessKey: rec.ticketAccessKey };
    delete payload.ticketId;

    const res = await fetchImpl(`${hubUrl}/api/support/remote/${encodeURIComponent(ticketId)}/client`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok)
        throw new Error(data.error || `Ошибка сигналинга Remote Desktop (HTTP ${res.status})`);
    return data;
}

export const SUPPORT_METHODS = Object.freeze({
    support_list: {
        level: 'user',
        fn: async function (p = {}) {
            return listSupportTicketsForWork(this, p);
        },
    },
    support_create: {
        level: 'user',
        fn: async function (p = {}) {
            return createSupportTicketFromWork(this, p);
        },
    },
    support_reply: {
        level: 'user',
        fn: async function (p = {}) {
            return replySupportTicketFromWork(this, p);
        },
    },
    support_mark_read: {
        level: 'user',
        fn: async function (p = {}) {
            return markSupportTicketRead(this, p);
        },
    },
    support_media: {
        level: 'user',
        fn: async function (p = {}) {
            return fetchSupportMediaFromWork(this, p);
        },
    },
    support_remote: {
        level: 'user',
        fn: async function (p = {}) {
            return relaySupportRemoteFromWork(this, p);
        },
    },
});
