/**
 * Серверное управление правилами проактивности ($structure/ai/triggers/*.md)
 * и расписаниями узла (scheduler.js) для куратора BOSS.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { loadDocs } from './resources.js';
import { resetTriggerCache } from './triggers.js';
import { createSchedule, listSchedules, toggleSchedule, cancelSchedule } from './scheduler.js';
import { DEV_MODE } from '../../host/config.js';
import { audit } from '../../server/access/audit.js';

const ACCESS_DENIED = 'Доступ запрещён';
const SAFE_RULE_NAME_RE = /^[A-Za-z0-9\u0400-\u04FF_-]{1,64}$/;

async function assertBoss(storage, params = {}) {
    if (DEV_MODE || !params?.session || params.session.$user === globalThis.WORK)
        return;
    const ok = await storage._canViewLocalFeed?.(params);
    if (!ok)
        throw new Error(ACCESS_DENIED);
}

function ownTriggersDir(storage) {
    const metaDir = storage?.meta_folder?.real_dir || storage?.meta_folder?.dir
        || (storage?.real_dir ? path.join(storage.real_dir, storage.type || '$class') : '');
    if (!metaDir)
        throw new Error('Не найдена метапапка узла');
    return path.join(metaDir, 'ai', 'triggers');
}

function yamlScalar(v) {
    if (typeof v === 'boolean' || typeof v === 'number')
        return String(v);
    const s = String(v ?? '');
    if (!s)
        return '""';
    if (/[:#\n"'{}[\]]|^\s|\s$/.test(s))
        return JSON.stringify(s);
    return s;
}

function serializeTriggerMd({ name, on, class: cls, ext, when, template, approval, as, notify, cooldownSec, maxPerHour, enabled, body }) {
    const lines = ['---'];
    lines.push(`name: ${yamlScalar(name)}`);
    lines.push(`on: ${yamlScalar(Array.isArray(on) ? on.join(', ') : (on || 'db:register'))}`);
    if (cls) lines.push(`class: ${yamlScalar(cls)}`);
    if (ext) lines.push(`ext: ${yamlScalar(ext)}`);
    if (when) lines.push(`when: ${yamlScalar(when)}`);
    if (template) lines.push(`template: ${yamlScalar(template)}`);
    if (approval) lines.push(`approval: true`);
    if (as) lines.push(`as: ${yamlScalar(as)}`);
    const notifyList = Array.isArray(notify) ? notify : String(notify || 'BOSS').split(/[\s,]+/).filter(Boolean);
    lines.push(`notify: [${notifyList.map(yamlScalar).join(', ')}]`);
    if (Number(cooldownSec) > 0) lines.push(`cooldownSec: ${Math.round(Number(cooldownSec))}`);
    lines.push(`maxPerHour: ${Math.max(1, Math.min(500, Number(maxPerHour) || 20))}`);
    if (enabled === false) lines.push(`enabled: false`);
    lines.push('---');
    const text = String(body || '').trim();
    if (text)
        lines.push(text);
    return lines.join('\n') + '\n';
}

export async function listNodeRules(storage, params = {}) {
    await assertBoss(storage, params);
    const docs = await loadDocs(storage, 'triggers');
    const ownDir = ownTriggersDir(storage);
    const ownNames = new Set(
        fs.existsSync(ownDir)
            ? fs.readdirSync(ownDir).filter(f => f.endsWith('.md')).map(f => f.slice(0, -3))
            : []
    );
    const triggers = [];
    for (const doc of docs.values()) {
        const m = doc.meta || {};
        triggers.push({
            name: doc.name,
            on: m.on || 'save',
            class: m.class || '',
            ext: m.ext || '',
            when: m.when || '',
            template: m.template || '',
            approval: Boolean(m.approval === true || m.approval === 'true'),
            as: m.as || '',
            notify: Array.isArray(m.notify) ? m.notify : String(m.notify || '').split(/[\s,]+/).filter(Boolean),
            cooldownSec: Number(m.cooldownSec) || 0,
            maxPerHour: Number(m.maxPerHour) || 20,
            enabled: m.enabled !== false,
            body: doc.body || '',
            own: ownNames.has(doc.name),
        });
    }
    const nodePath = storage?.path || '/';
    const schedules = await listSchedules({ nodePath }).catch(() => []);
    const proactivity = {
        autoReply: storage?.DATA?.proactivity?.autoReply !== false,
        quietDigest: storage?.DATA?.proactivity?.quietDigest !== false,
    };
    return { triggers, schedules, proactivity };
}

export async function saveNodeRule(storage, params = {}) {
    await assertBoss(storage, params);
    const post = (typeof params.post === 'string' ? JSON.parse(params.post) : params.post) || params;
    const name = String(post.name || '').trim().replace(/\.md$/i, '');
    if (!SAFE_RULE_NAME_RE.test(name))
        throw new Error('Недопустимое имя правила (допустимы буквы, цифры, _ и -)');

    const dir = ownTriggersDir(storage);
    const filePath = path.join(dir, `${name}.md`);

    if (post.delete === true) {
        if (fs.existsSync(filePath))
            await fsp.rm(filePath, { force: true });
        resetTriggerCache();
        audit('agent_rule_delete', { name, point: storage.path, params });
        return { ok: true, deleted: name };
    }

    const uid = storage.constructor?.resolveUid?.(params) || post.as || '';
    const asUid = String(post.as || uid).trim();
    if (!asUid)
        throw new Error('Не указан исполнитель (as) для правила');

    const md = serializeTriggerMd({
        name,
        on: post.on || 'db:register',
        class: post.class || '',
        ext: post.ext || '',
        when: post.when || '',
        template: post.template || '',
        approval: Boolean(post.approval),
        as: asUid,
        notify: post.notify || ['BOSS'],
        cooldownSec: post.cooldownSec || 0,
        maxPerHour: post.maxPerHour || 20,
        enabled: post.enabled !== false,
        body: post.body || '',
    });

    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(filePath, md, 'utf8');
    storage?.meta_folder?.reset?.();
    storage?.reset?.();
    resetTriggerCache();
    audit('agent_rule_save', { name, point: storage.path, params });
    return { ok: true, name };
}

export async function saveNodeSchedule(storage, params = {}) {
    await assertBoss(storage, params);
    const post = (typeof params.post === 'string' ? JSON.parse(params.post) : params.post) || params;
    const nodePath = storage?.path || '/';
    const uid = storage.constructor?.resolveUid?.(params) || String(post.uid || '').trim();
    if (!uid)
        throw new Error('Не определён владелец расписания');

    if (post.delete === true && post.id) {
        await cancelSchedule({ uid, id: post.id });
        return { ok: true, deleted: post.id };
    }
    if (post.toggle === true && post.id) {
        return toggleSchedule({ id: post.id, enabled: post.enabled });
    }
    return createSchedule({
        uid,
        nodePath,
        label: post.label || 'Задача по расписанию',
        prompt: post.prompt,
        rule: post.rule,
        tz: post.tz,
    });
}

/**
 * Сохранить базовые настройки проактивности узла (`autoReply`, `quietDigest`) в class.js.
 */
export async function saveNodeProactivity(storage, params = {}) {
    await assertBoss(storage, params);
    const post = (typeof params.post === 'string' ? JSON.parse(params.post) : params.post) || params;
    const prev = storage?.DATA?.proactivity && typeof storage.DATA.proactivity === 'object' ? storage.DATA.proactivity : {};
    const next = {
        ...prev,
        ...(typeof post.autoReply === 'boolean' ? { autoReply: post.autoReply } : {}),
        ...(typeof post.quietDigest === 'boolean' ? { quietDigest: post.quietDigest } : {}),
    };
    if (typeof storage?.save === 'function') {
        await storage.save({ proactivity: next }, params);
    }
    else if (storage?.DATA) {
        storage.DATA.proactivity = next;
    }
    return { ok: true, proactivity: next };
}

/**
 * Собрать реальные заметные события узла для тихой сводки руководителю (0 событий => пустой список).
 */
export async function collectQuietDigest(storage) {
    if (!storage)
        return { events: [], nodePath: '/' };
    const nodePath = String(storage.path || '/').replace(/\/+$/, '') || '/';
    const events = [];
    try {
        const { dbForThreadStorage } = await import('../../server/chat-threads.js');
        const db = await dbForThreadStorage(storage, 'twin');
        const now = Date.now();
        const hourAgo = now - 3600_000;
        const min15Ago = now - 15 * 60_000;

        // 1. Ожидающие утверждения карточки (старше 1 часа)
        const pendingApprovals = db.prepare(`
            SELECT m.id, m.content, m.created
            FROM chat_messages m
            JOIN chat_threads t ON t.id = m.thread_id
            WHERE t.kind = 'twin' AND t.node_path = ? AND m.kind = 'approval' AND m.created <= ?
              AND (m.meta LIKE '%"status":"pending"%' OR m.meta LIKE '%"status": "pending"%')
            ORDER BY m.created DESC LIMIT 5
        `).all(nodePath, hourAgo);
        for (const a of pendingApprovals) {
            events.push(`Ожидает решения: «${String(a.content || '').slice(0, 90)}»`);
        }

        // 2. Неотвеченные текстовые обращения пользователей/клиентов в twin-диалогах этого узла (без .task-карточек, за последние 3 дня)
        const threeDaysAgo = now - 3 * 86400_000;
        const threads = db.prepare(`
            SELECT id FROM chat_threads WHERE kind = 'twin' AND node_path = ?
        `).all(nodePath);
        let unansweredCount = 0;
        for (const t of threads) {
            const lastMsg = db.prepare('SELECT sender, kind, task_path, created FROM chat_messages WHERE thread_id = ? ORDER BY id DESC LIMIT 1').get(t.id);
            if (lastMsg
                && lastMsg.sender !== '$twin'
                && lastMsg.kind === 'text'
                && !lastMsg.task_path
                && Number(lastMsg.created) <= min15Ago
                && Number(lastMsg.created) >= threeDaysAgo)
                unansweredCount++;
        }
        if (unansweredCount > 0)
            events.push(`Неотвеченных обращений в диалогах узла: ${unansweredCount}`);
    }
    catch { /* ignore */ }

    try {
        const schedules = await listSchedules({ nodePath }).catch(() => []);
        const failed = schedules.filter(s => s.lastError);
        if (failed.length)
            events.push(`Ошибки расписания (${failed.length}): ${failed[0].label} — ${String(failed[0].lastError).slice(0, 80)}`);
    }
    catch { /* ignore */ }

    return { nodePath, events };
}

const lastDigestDayByNode = new Map();

/**
 * Проверить узлы $base/$project/$structure и отправить тихую сводку BOSS только при наличии реальных событий.
 */
export async function runQuietDigests({ now = Date.now(), nodes = null } = {}) {
    const WORK = globalThis.WORK;
    if (!WORK && !Array.isArray(nodes))
        return [];
    const dayKey = new Date(now).toISOString().slice(0, 10);
    const list = Array.isArray(nodes) ? nodes : [];
    if (!list.length && WORK) {
        const collectTargets = async (containerPath) => {
            const c = await WORK.get_item(containerPath).catch(() => null);
            const items = (await c?.items) || [];
            for (const base of items) {
                if (!base || base.id?.[0] === '$') continue;
                list.push(base);
                const sub = (await base.items) || [];
                for (const child of sub) {
                    if (child && child.type === '$structure' && child.id?.[0] !== '$')
                        list.push(child);
                }
            }
        };
        await collectTargets('/ORGANIZATIONS');
        await collectTargets('/PROJECTS');
    }

    const sent = [];
    for (const nodeItem of list) {
        if (!nodeItem || nodeItem.DATA?.proactivity?.quietDigest === false)
            continue;
        const nodePath = String(nodeItem.path || '/').replace(/\/+$/, '') || '/';
        if (lastDigestDayByNode.get(nodePath) === dayKey)
            continue;
        const { events } = await collectQuietDigest(nodeItem);
        if (!events.length)
            continue;
        const bosses = await Promise.resolve(nodeItem.bosses).catch(() => []);
        const topBosses = bosses?.length ? bosses : (await Promise.resolve(nodeItem.allBosses).catch(() => []));
        const bossUid = topBosses?.[0]?.id || topBosses?.at?.(-1)?.id;
        if (!bossUid)
            continue;
        const label = nodeItem.DATA?.label || nodeItem.label || nodeItem.id || nodePath;
        const msg = `Сводка узла «${label}» (${dayKey}):\n` + events.map(e => `• ${e}`).join('\n');
        const CHAT = await import('../../server/chat-threads.js');
        await CHAT.sendMessage(nodeItem, {
            uid: bossUid,
            asTwin: true,
            kind: 'text',
            message: msg,
            meta: { digestDay: dayKey },
        }).catch(() => {});
        lastDigestDayByNode.set(nodePath, dayKey);
        sent.push({ nodePath, bossUid, eventsCount: events.length });
    }
    return sent;
}
