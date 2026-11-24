/**
 * Ядро бесед мессенджера WORK (`chat_threads`, `chat_participants`, `chat_messages`):
 *  - kind = 'twin'  : персональный диалог пользователя с Агентом узла ($server/$base/$project/$structure);
 *                     хранится в work.db организации/проекта (или .data/work.db для корня $server).
 *                     BOSS узла может просматривать взаимодействия пользователей/клиентов с этим Агентом.
 *  - kind = 'dm'    : приватный диалог Человек ↔ Человек (включая диалог со своим $user-двойником);
 *                     хранится в корневой .data/work.db и доступен строго двоим участникам.
 *  - kind = 'group' : тематическая группа людей; хранится в БД контекста создания.
 */
import crypto from 'node:crypto';
import * as LOGS from './logs.js';
import * as REFS from './access/refs.js';
import * as WORKPLACES from './access/workplaces.js';
import { dataDb, tx } from '../data/db.js';
import { DEV_MODE } from '../host/config.js';

function notifyChatEvent(uids, payload) {
    import('../host/websocket.js')
        .then(m => m.broadcastChatEvent?.(uids, payload))
        .catch(() => {});
}

const ACCESS_DENIED = 'Доступ запрещён';

export function twinThreadId(nodePath, uid) {
    const norm = String(nodePath || '/').trim().replace(/\/+$/, '') || '/';
    return `twin:${norm}:${String(uid || '').trim()}`;
}

export function dmThreadId(uid1, uid2) {
    const pair = [String(uid1 || '').trim(), String(uid2 || '').trim()].sort();
    return `dm:${pair[0]}|${pair[1]}`;
}

function rootDirOf() {
    return globalThis.WORK?.real_dir || globalThis.WORK?.dir || process.cwd();
}

export async function dbForThreadStorage(storage, kind = '') {
    if (kind === 'dm' || storage?.type === '$user')
        return dataDb('', rootDirOf());
    return LOGS.dbForStorage(storage);
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

function parseJsonSafe(raw, fallback) {
    try {
        return raw ? JSON.parse(raw) : fallback;
    }
    catch {
        return fallback;
    }
}

function normalizeAttachments(raw) {
    let arr = raw;
    if (typeof raw === 'string')
        arr = parseJsonSafe(raw, []);
    if (!Array.isArray(arr))
        return [];
    const out = [];
    for (const item of arr) {
        if (!item) continue;
        if (typeof item === 'string') {
            const p = REFS.normPath(item);
            if (p) out.push({ path: p, name: p.split('/').pop() || 'file' });
        }
        else if (typeof item === 'object' && item.path) {
            const p = REFS.normPath(item.path);
            if (p) out.push({ path: p, name: String(item.name || p.split('/').pop() || 'file') });
        }
    }
    return out;
}

function normalizeMentions(raw) {
    let arr = raw;
    if (typeof raw === 'string')
        arr = parseJsonSafe(raw, raw.split(',').map(s => s.trim()).filter(Boolean));
    if (!Array.isArray(arr))
        return [];
    return [...new Set(arr.map(s => String(s || '').trim()).filter(Boolean))];
}

function formatMessageRow(r) {
    if (!r) return null;
    return {
        id: Number(r.id),
        threadId: r.thread_id,
        sender: r.sender,
        kind: r.kind || 'text',
        content: r.content || '',
        replyTo: r.reply_to != null ? Number(r.reply_to) : null,
        mentions: parseJsonSafe(r.mentions, []),
        attachments: parseJsonSafe(r.attachments, []),
        taskPath: r.task_path || '',
        meta: parseJsonSafe(r.meta, {}),
        created: Number(r.created) || 0,
    };
}

/** Открыть или создать беседу (twin на $structure, dm на $user, или group). */
export async function openThread(storage, params = {}) {
    const uid = resolveActorUid(storage, params);
    if (!uid)
        throw new Error(ACCESS_DENIED);

    const requestedKind = String(params.kind || '').trim();
    const kind = requestedKind === 'group' ? 'group' : (storage?.type === '$user' || requestedKind === 'dm' ? 'dm' : 'twin');
    const db = await dbForThreadStorage(storage, kind);
    const now = Date.now();

    if (kind === 'dm') {
        const peerId = String(params.peerId || (storage?.type === '$user' ? storage.id : '')).trim();
        if (!peerId)
            throw new Error('Не указан собеседник (peerId)');
        const threadId = dmThreadId(uid, peerId);
        const title = String(params.title || '').trim();
        tx(db, () => {
            db.prepare(`
                INSERT OR IGNORE INTO chat_threads (id, kind, node_path, title, created_by, created, updated)
                VALUES (?, 'dm', '', ?, ?, ?, ?)
            `).run(threadId, title, uid, now, now);
            db.prepare(`
                INSERT OR IGNORE INTO chat_participants (thread_id, uid, role, last_read_id, joined)
                VALUES (?, ?, 'member', 0, ?)
            `).run(threadId, uid, now);
            if (peerId !== uid) {
                db.prepare(`
                    INSERT OR IGNORE INTO chat_participants (thread_id, uid, role, last_read_id, joined)
                    VALUES (?, ?, 'member', 0, ?)
                `).run(threadId, peerId, now);
            }
        });
        return getThreadWithMeta(db, threadId, uid);
    }

    if (kind === 'group') {
        const threadId = params.threadId && String(params.threadId).startsWith('group:')
            ? String(params.threadId)
            : `group:${crypto.randomUUID()}`;
        const nodePath = LOGS.feedPathOf(storage);
        const title = String(params.title || 'Группа').trim();
        let members = Array.isArray(params.participants)
            ? params.participants
            : (typeof params.participants === 'string' ? parseJsonSafe(params.participants, []) : []);
        members = [...new Set([uid, ...members.map(m => String(m || '').trim()).filter(Boolean)])];
        tx(db, () => {
            db.prepare(`
                INSERT OR IGNORE INTO chat_threads (id, kind, node_path, title, created_by, created, updated)
                VALUES (?, 'group', ?, ?, ?, ?, ?)
            `).run(threadId, nodePath, title, uid, now, now);
            for (const m of members) {
                db.prepare(`
                    INSERT OR IGNORE INTO chat_participants (thread_id, uid, role, last_read_id, joined)
                    VALUES (?, ?, ?, 0, ?)
                `).run(threadId, m, m === uid ? 'owner' : 'member', now);
            }
        });
        return getThreadWithMeta(db, threadId, uid);
    }

    // kind === 'twin': персональный диалог пользователя с Агентом узла ($server/$base/$project/$structure)
    if (!DEV_MODE && params?.session && params.session.$user !== globalThis.WORK) {
        const canSee = await storage.canSee?.(storage, params).catch(() => false);
        const roles = await storage.roles?.(params).catch(() => []);
        if (!canSee && !roles.length)
            throw new Error(ACCESS_DENIED);
    }
    const nodePath = LOGS.feedPathOf(storage);
    const threadId = twinThreadId(nodePath, uid);
    const roles = await storage.roles?.(params).catch(() => []) || [];
    const partRole = roles.includes('BOSS') ? 'owner' : (roles.includes('CLIENT') && !roles.includes('USER') ? 'client' : 'member');
    const title = String(params.title || storage.DATA?.label || storage.label || storage.id || nodePath).trim();
    tx(db, () => {
        db.prepare(`
            INSERT OR IGNORE INTO chat_threads (id, kind, node_path, title, created_by, created, updated)
            VALUES (?, 'twin', ?, ?, ?, ?, ?)
        `).run(threadId, nodePath, title, uid, now, now);
        db.prepare(`
            INSERT OR IGNORE INTO chat_participants (thread_id, uid, role, last_read_id, joined)
            VALUES (?, ?, ?, 0, ?)
        `).run(threadId, uid, partRole, now);
    });
    return getThreadWithMeta(db, threadId, uid);
}

function getThreadWithMeta(db, threadId, uid) {
    const t = db.prepare('SELECT * FROM chat_threads WHERE id = ?').get(threadId);
    if (!t) return null;
    const parts = db.prepare('SELECT uid, role, last_read_id, joined FROM chat_participants WHERE thread_id = ?').all(threadId);
    const mine = parts.find(p => p.uid === uid);
    const lastReadId = Number(mine?.last_read_id) || 0;
    const unreadRow = mine
        ? db.prepare('SELECT COUNT(*) AS cnt FROM chat_messages WHERE thread_id = ? AND id > ? AND sender != ?').get(threadId, lastReadId, uid)
        : { cnt: 0 };
    const lastMsg = db.prepare('SELECT * FROM chat_messages WHERE thread_id = ? ORDER BY id DESC LIMIT 1').get(threadId);
    const countRow = db.prepare('SELECT COUNT(*) AS cnt FROM chat_messages WHERE thread_id = ?').get(threadId);
    return {
        id: t.id,
        kind: t.kind,
        nodePath: t.node_path,
        title: t.title,
        createdBy: t.created_by,
        created: Number(t.created),
        updated: Number(t.updated),
        participants: parts.map(p => ({
            uid: p.uid,
            role: p.role,
            lastReadId: Number(p.last_read_id) || 0,
            joined: Number(p.joined) || 0,
        })),
        unreadCount: Number(unreadRow?.cnt) || 0,
        messageCount: Number(countRow?.cnt) || 0,
        lastMessage: formatMessageRow(lastMsg),
    };
}

/** Список бесед: личных/своих (mine) либо всех взаимодействий с Агентом узла (audit, только BOSS). */
export async function listThreads(storage, params = {}) {
    const uid = resolveActorUid(storage, params);
    if (!uid)
        throw new Error(ACCESS_DENIED);

    const mode = params.mode === 'audit' ? 'audit' : 'mine';
    const limit = Math.max(1, Math.min(200, Number(params.limit) || 100));

    if (mode === 'audit') {
        if (!(await storage._canViewLocalFeed?.(params)))
            throw new Error(ACCESS_DENIED);
        const db = await dbForThreadStorage(storage, 'twin');
        const nodePath = LOGS.feedPathOf(storage);
        const rows = db.prepare(`
            SELECT id FROM chat_threads
            WHERE kind = 'twin' AND node_path = ?
            ORDER BY updated DESC
            LIMIT ?
        `).all(nodePath, limit);
        return rows.map(r => getThreadWithMeta(db, r.id, uid)).filter(Boolean);
    }

    const kind = storage?.type === '$user' ? 'dm' : '';
    const db = await dbForThreadStorage(storage, kind);
    const nodeFilter = params.nodePath != null ? String(params.nodePath).trim() : '';
    const rows = nodeFilter
        ? db.prepare(`
            SELECT t.id FROM chat_threads t
            JOIN chat_participants p ON p.thread_id = t.id
            WHERE p.uid = ? AND t.node_path = ?
            ORDER BY t.updated DESC
            LIMIT ?
        `).all(uid, nodeFilter, limit)
        : db.prepare(`
            SELECT t.id FROM chat_threads t
            JOIN chat_participants p ON p.thread_id = t.id
            WHERE p.uid = ?
            ORDER BY t.updated DESC
            LIMIT ?
        `).all(uid, limit);
    return rows.map(r => getThreadWithMeta(db, r.id, uid)).filter(Boolean);
}

/** Получить сообщения беседы с проверкой прав (участник или BOSS узла для twin-аудита). */
export async function listMessages(storage, params = {}) {
    const uid = resolveActorUid(storage, params);
    if (!uid)
        throw new Error(ACCESS_DENIED);

    let threadId = String(params.threadId || '').trim();
    if (!threadId) {
        const isDm = storage?.type === '$user' || params.kind === 'dm';
        if (isDm) {
            const peerId = String(params.peerId || (storage?.type === '$user' ? storage.id : '')).trim();
            if (!peerId)
                throw new Error('Не указан threadId или peerId');
            threadId = dmThreadId(uid, peerId);
        }
        else {
            threadId = twinThreadId(LOGS.feedPathOf(storage), uid);
        }
    }

    const kindHint = threadId.startsWith('dm:') ? 'dm' : 'twin';
    const db = await dbForThreadStorage(storage, kindHint);
    const thread = getThreadWithMeta(db, threadId, uid);
    if (!thread)
        return { thread: null, messages: [] };

    const isParticipant = thread.participants.some(p => p.uid === uid);
    if (!isParticipant) {
        // Чужой DM никогда не открывается; чужой twin-диалог узла открывается только BOSS этого узла
        const canAuditTwin = thread.kind === 'twin'
            && thread.nodePath === LOGS.feedPathOf(storage)
            && await storage._canViewLocalFeed?.(params);
        if (!canAuditTwin)
            throw new Error(ACCESS_DENIED);
    }

    const limit = Math.max(1, Math.min(200, Number(params.limit) || 100));
    const beforeId = Number(params.beforeId) || 0;
    const rows = beforeId > 0
        ? db.prepare(`
            SELECT * FROM chat_messages
            WHERE thread_id = ? AND id < ?
            ORDER BY id DESC
            LIMIT ?
        `).all(threadId, beforeId, limit)
        : db.prepare(`
            SELECT * FROM chat_messages
            WHERE thread_id = ?
            ORDER BY id DESC
            LIMIT ?
        `).all(threadId, limit);

    rows.reverse();
    return { thread, messages: rows.map(formatMessageRow) };
}

/** Отправить сообщение в беседу (создав её при необходимости) + выдать доступ к вложениям + WebSocket-рассылка. */
export async function sendMessage(storage, params = {}) {
    const uid = resolveActorUid(storage, params);
    if (!uid)
        throw new Error(ACCESS_DENIED);

    const isTwinBot = params.asTwin === true && (!params.session || params.session.$user === globalThis.WORK || DEV_MODE);
    const sender = isTwinBot ? '$twin' : uid;

    let threadId = String(params.threadId || '').trim();
    const kindHint = threadId ? (threadId.startsWith('dm:') ? 'dm' : 'twin') : (storage?.type === '$user' || params.kind === 'dm' ? 'dm' : 'twin');
    const db = await dbForThreadStorage(storage, kindHint);

    let thread = threadId ? getThreadWithMeta(db, threadId, uid) : null;
    if (!thread) {
        thread = await openThread(storage, params);
        threadId = thread.id;
    }

    const isParticipant = thread.participants.some(p => p.uid === uid);
    if (!isParticipant && !isTwinBot)
        throw new Error(ACCESS_DENIED);

    const content = String(params.message ?? params.content ?? '');
    const msgKind = String(params.kind || 'text').trim() || 'text';
    const taskPath = String(params.taskPath || '').trim();
    const replyTo = params.replyTo != null && Number.isFinite(Number(params.replyTo)) ? Number(params.replyTo) : null;
    const mentions = normalizeMentions(params.mentions);
    const attachments = normalizeAttachments(params.attachments);
    const meta = (params.meta && typeof params.meta === 'object') ? params.meta : (typeof params.meta === 'string' ? parseJsonSafe(params.meta, {}) : {});

    // Проверяем видимость вложений отправителем и выдаём участникам беседы доступ к конкретным файлам (Q8)
    const attPaths = attachments.map(a => a.path);
    if (taskPath)
        attPaths.push(REFS.normPath(taskPath));
    if (attPaths.length) {
        await LOGS.assertIncludesVisible(attPaths, params);
        for (const p of thread.participants) {
            await REFS.addRow(p.uid, { time: Date.now(), includes: attPaths }, `chat:${threadId}`);
        }
    }

    const now = Date.now();
    let insertedId = 0;
    tx(db, () => {
        const res = db.prepare(`
            INSERT INTO chat_messages (thread_id, sender, kind, content, reply_to, mentions, attachments, task_path, meta, created)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            threadId,
            sender,
            msgKind,
            content,
            replyTo,
            JSON.stringify(mentions),
            JSON.stringify(attachments),
            taskPath,
            JSON.stringify(meta),
            now
        );
        insertedId = Number(res.lastInsertRowid);
        db.prepare('UPDATE chat_threads SET updated = ? WHERE id = ?').run(now, threadId);
        if (!isTwinBot) {
            db.prepare('UPDATE chat_participants SET last_read_id = MAX(last_read_id, ?) WHERE thread_id = ? AND uid = ?')
                .run(insertedId, threadId, uid);
        }
    });

    const saved = formatMessageRow(db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(insertedId));
    const notifyUids = thread.participants.map(p => p.uid);
    notifyChatEvent(notifyUids, {
        type: 'chat:message',
        threadId,
        kind: thread.kind,
        nodePath: thread.nodePath,
        message: saved,
    });
    if (!isTwinBot && thread.kind === 'twin') {
        globalThis.__workPendingTriggers = (globalThis.__workPendingTriggers || 0) + 1;
        import('../modules/agent/triggers.js')
            .then(m => m.onChatEvent?.({ storage, thread, message: saved, params }))
            .catch(() => {})
            .finally(() => {
                globalThis.__workPendingTriggers = Math.max(0, (globalThis.__workPendingTriggers || 1) - 1);
            });
    }
    return saved;
}

/** Отметить беседу прочитанной и разослать событие по другим вкладкам пользователя. */
export async function markRead(storage, params = {}) {
    const uid = resolveActorUid(storage, params);
    if (!uid)
        throw new Error(ACCESS_DENIED);
    const threadId = String(params.threadId || '').trim();
    if (!threadId)
        throw new Error('Не указан threadId');

    const kindHint = threadId.startsWith('dm:') ? 'dm' : 'twin';
    const db = await dbForThreadStorage(storage, kindHint);
    const part = db.prepare('SELECT last_read_id FROM chat_participants WHERE thread_id = ? AND uid = ?').get(threadId, uid);
    if (!part)
        return { ok: false, lastReadId: 0 };

    const maxRow = db.prepare('SELECT COALESCE(MAX(id), 0) AS max_id FROM chat_messages WHERE thread_id = ?').get(threadId);
    const targetId = params.lastMessageId != null ? Math.min(Number(params.lastMessageId) || 0, Number(maxRow?.max_id) || 0) : (Number(maxRow?.max_id) || 0);
    const nextRead = Math.max(Number(part.last_read_id) || 0, targetId);
    db.prepare('UPDATE chat_participants SET last_read_id = ? WHERE thread_id = ? AND uid = ?').run(nextRead, threadId, uid);
    notifyChatEvent([uid], {
        type: 'chat:read',
        threadId,
        uid,
        lastReadId: nextRead,
    });
    return { ok: true, lastReadId: nextRead };
}

/** Сводка непрочитанного для текущего пользователя в БД данного узла/сервера. */
export async function unreadSummary(storage, params = {}) {
    const uid = resolveActorUid(storage, params);
    if (!uid)
        return { total: 0, byThread: {}, byNode: {}, byPeer: {} };
    const db = await dbForThreadStorage(storage, params.kind || '');
    const rows = db.prepare(`
        SELECT t.id, t.kind, t.node_path,
               (SELECT COUNT(*) FROM chat_messages m WHERE m.thread_id = t.id AND m.id > p.last_read_id AND m.sender != ?) AS unread
        FROM chat_threads t
        JOIN chat_participants p ON p.thread_id = t.id
        WHERE p.uid = ?
    `).all(uid, uid);
    const byThread = {};
    const byNode = {};
    const byPeer = {};
    let total = 0;
    for (const r of rows) {
        const cnt = Number(r.unread) || 0;
        if (!cnt) continue;
        total += cnt;
        byThread[r.id] = cnt;
        if (r.kind === 'twin' && r.node_path) {
            byNode[r.node_path] = (byNode[r.node_path] || 0) + cnt;
        }
        else if (r.kind === 'dm') {
            const parts = String(r.id).slice(3).split('|');
            const peer = parts[0] === uid && parts[1] === uid ? uid : (parts[0] === uid ? parts[1] : parts[0]);
            if (peer)
                byPeer[peer] = (byPeer[peer] || 0) + cnt;
        }
    }
    return { total, byThread, byNode, byPeer };
}

/**
 * Вычисляемый список контактов («Люди») для левого навигатора (Q18):
 *  - свой $user закреплён первым;
 *  - BOSS WORK (или DEV_MODE) видит всех /USERS;
 *  - обычный пользователь видит коллег из общих $base/$project и внешних клиентов/собеседников.
 */
export async function visibleContacts(storage, params = {}) {
    const uid = resolveActorUid(storage, params);
    const usersRoot = await globalThis.WORK?.get_item?.('/USERS').catch(() => null);
    const allUserItems = usersRoot ? ((await usersRoot.items) || []).filter(u => u && u.id && u.id[0] !== '$') : [];

    const userMap = new Map();
    for (const u of allUserItems) {
        await u.init?.catch?.(() => {});
        userMap.set(u.id, {
            id: u.id,
            path: u.path || `/USERS/${u.id}`,
            label: u.DATA?.label || u.label || u.id,
            icon: u.DATA?.icon || u.icon || '',
            online: Boolean(u.online),
            self: u.id === uid,
            external: false,
        });
    }

    const isWorkBoss = uid && globalThis.WORK
        ? (DEV_MODE || !params?.session || params.session.$user === globalThis.WORK || await globalThis.WORK._isWorkBoss?.(params).catch(() => false))
        : Boolean(DEV_MODE);

    const visibleIds = new Set();
    const externalOnlyIds = new Set();
    if (uid && userMap.has(uid))
        visibleIds.add(uid);

    if (isWorkBoss) {
        for (const id of userMap.keys())
            visibleIds.add(id);
    }
    else if (uid) {
        // Ищем коллег по всем $base и $project, где участвует текущий пользователь
        const collectFromContainer = async (domainPath) => {
            const dom = await globalThis.WORK?.get_item?.(domainPath).catch(() => null);
            const containers = dom ? ((await dom.items) || []).filter(c => c && c.id && c.id[0] !== '$') : [];
            for (const base of containers) {
                const units = [base];
                const sub = await base.items?.catch?.(() => []) || [];
                for (const s of sub) {
                    if (s?.type === '$structure')
                        units.push(s);
                }
                let callerInBase = false;
                const internalSet = new Set();
                const externalSet = new Set();
                for (const u of units) {
                    await u.init?.catch?.(() => {});
                    const sec = u.DATA?.['#security'] || {};
                    const roles = await u.roles?.(params).catch(() => []) || [];
                    if (roles.length)
                        callerInBase = true;
                    for (const id of Array.isArray(sec.BOSS) ? sec.BOSS : []) {
                        if (!WORKPLACES.isPseudoUser(id)) internalSet.add(id);
                    }
                    for (const id of Array.isArray(sec.USER) ? sec.USER : []) {
                        if (!WORKPLACES.isPseudoUser(id)) internalSet.add(id);
                    }
                    const { places } = WORKPLACES.normalizeSecurity(sec);
                    for (const { node } of WORKPLACES.walkPlaces(places)) {
                        for (const id of node.USERS || []) {
                            if (WORKPLACES.isPseudoUser(id)) continue;
                            if (node.external) externalSet.add(id);
                            else internalSet.add(id);
                        }
                    }
                }
                if (callerInBase) {
                    for (const id of internalSet) {
                        visibleIds.add(id);
                        externalOnlyIds.delete(id);
                    }
                    for (const id of externalSet) {
                        if (!visibleIds.has(id)) {
                            visibleIds.add(id);
                            externalOnlyIds.add(id);
                        }
                    }
                }
            }
        };
        await collectFromContainer('/ORGANIZATIONS');
        await collectFromContainer('/PROJECTS');

        // Добавляем всех собеседников из открытых DM/групп в .data/work.db
        try {
            const db = await dataDb('', rootDirOf());
            const dmPeers = db.prepare(`
                SELECT DISTINCT p2.uid FROM chat_participants p1
                JOIN chat_participants p2 ON p2.thread_id = p1.thread_id
                WHERE p1.uid = ? AND p2.uid != ?
            `).all(uid, uid);
            for (const r of dmPeers)
                visibleIds.add(r.uid);
        }
        catch { /* ignore */ }
    }

    const out = [];
    if (uid && userMap.has(uid))
        out.push(userMap.get(uid));
    for (const id of visibleIds) {
        if (id === uid) continue;
        const entry = userMap.get(id);
        if (!entry) continue;
        out.push({
            ...entry,
            external: externalOnlyIds.has(id),
        });
    }
    return out;
}

/**
 * Подтвердить или отклонить карточку действия (kind = 'approval') в беседе.
 */
export async function resolveApproval(storage, params = {}) {
    const uid = resolveActorUid(storage, params);
    if (!uid)
        throw new Error(ACCESS_DENIED);
    const threadId = String(params.threadId || '').trim();
    const messageId = Number(params.messageId);
    const action = params.action === 'approve' ? 'approve' : (params.action === 'reject' ? 'reject' : '');
    if (!threadId || !Number.isFinite(messageId) || !action)
        throw new Error('Требуются threadId, messageId и action (approve|reject)');

    const kindHint = threadId.startsWith('dm:') ? 'dm' : 'twin';
    const db = await dbForThreadStorage(storage, kindHint);
    const thread = getThreadWithMeta(db, threadId, uid);
    if (!thread)
        throw new Error('Беседа не найдена');

    const isParticipant = thread.participants.some(p => p.uid === uid);
    const isBoss = thread.kind === 'twin'
        && thread.nodePath === LOGS.feedPathOf(storage)
        && await storage._canViewLocalFeed?.(params);
    if (!isParticipant && !isBoss)
        throw new Error(ACCESS_DENIED);

    const row = db.prepare('SELECT * FROM chat_messages WHERE id = ? AND thread_id = ?').get(messageId, threadId);
    if (!row)
        throw new Error('Сообщение не найдено');
    if (row.kind !== 'approval')
        throw new Error('Сообщение не является карточкой подтверждения');
    const meta = parseJsonSafe(row.meta, {});
    if (meta.status && meta.status !== 'pending')
        return { ok: true, alreadyResolved: true, message: formatMessageRow(row) };

    const nextMeta = {
        ...meta,
        status: action === 'approve' ? 'approved' : 'rejected',
        resolvedBy: uid,
        resolvedAt: Date.now(),
    };
    db.prepare('UPDATE chat_messages SET meta = ? WHERE id = ?').run(JSON.stringify(nextMeta), messageId);
    const updated = formatMessageRow(db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(messageId));
    notifyChatEvent(thread.participants.map(p => p.uid), {
        type: 'chat:action',
        threadId,
        message: updated,
    });
    return { ok: true, message: updated };
}
