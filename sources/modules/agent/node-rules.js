/**
 * Серверное управление правилами проактивности ($structure/ai/triggers/*.md)
 * и расписаниями узла (scheduler.js) для куратора BOSS.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { loadDocs, aiDirs } from './resources.js';
import { parseFrontmatter } from './util.js';
import { resetTriggerCache } from './triggers.js';
import { createSchedule, listSchedules, toggleSchedule, cancelSchedule } from './scheduler.js';
import { DEV_MODE } from '../../host/config.js';
import { audit } from '../../server/access/audit.js';
import { FS } from '../../server/index.js';

const ACCESS_DENIED = 'Доступ запрещён';
const SAFE_RULE_NAME_RE = /^[A-Za-z0-9\u0400-\u04FF_-]{1,64}$/;
/** Единый порядок классов и модулей в дереве прав: по названию, без зависимости от порядка файлов. */
const TREE_LABEL_COLLATOR = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' });
function compareTreeLabels(a, b) {
    return TREE_LABEL_COLLATOR.compare(String(a?.label ?? a?.id ?? ''), String(b?.label ?? b?.id ?? ''));
}

async function assertBoss(storage, params = {}) {
    if (DEV_MODE || !params?.session || params.session.$user === globalThis.WORK)
        return;
    const roles = await storage.roles?.(params).catch(() => []) || [];
    if (roles.includes('BOSS') || await storage._isWorkBoss?.(params).catch(() => false))
        return;
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

function serializeTriggerMd({ name, label, on, class: cls, ext, when, template, approval, as, notify, cooldownSec, maxPerHour, enabled, body }) {
    const lines = ['---'];
    lines.push(`name: ${yamlScalar(name)}`);
    if (label && label !== name) lines.push(`label: ${yamlScalar(label)}`);
    lines.push(`on: ${yamlScalar(Array.isArray(on) ? on.join(', ') : (on || 'db:register'))}`);
    if (cls) lines.push(`class: ${yamlScalar(cls)}`);
    if (ext) lines.push(`ext: ${yamlScalar(ext)}`);
    if (when) lines.push(`when: ${yamlScalar(when)}`);
    if (template) lines.push(`template: ${yamlScalar(template)}`);
    if (approval) lines.push(`approval: true`);
    lines.push(`as: ${yamlScalar(as || 'BOSS')}`);
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
            label: m.label || doc.name,
            on: m.on || 'save',
            class: m.class || '',
            ext: m.ext || '',
            when: m.when || '',
            template: m.template || '',
            approval: Boolean(m.approval === true || m.approval === 'true'),
            as: m.as || 'BOSS',
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
        await recordBossSettingTask(storage, params, {
            title: `Удалена реакция «${name}»`,
            summary: `В подразделении ${storage.path || '/'} удалена автоматическая реакция «${name}».`,
        });
        return { ok: true, deleted: name };
    }

    const asUid = String(post.as || 'BOSS').trim() || 'BOSS';

    const md = serializeTriggerMd({
        name,
        label: post.label || name,
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
    await recordBossSettingTask(storage, params, {
        title: `Настроена реакция «${post.label || name}»`,
        summary: `В подразделении ${storage.path || '/'} сохранена автоматическая реакция «${post.label || name}» (событие: ${post.on || 'db:register'}).`,
    });
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
        await cancelSchedule({ uid, id: post.id }).catch(async () => {
            // Если расписание создавал прежний BOSS — разрешаем BOSS узла удалить
            const { indexDb } = await import('../../host/index-db.js');
            const d = await indexDb();
            d?.prepare('DELETE FROM agent_schedules WHERE id = ? AND node_path = ?').run(String(post.id), nodePath);
        });
        await recordBossSettingTask(storage, params, {
            title: `Удалено расписание (${post.id})`,
            summary: `В подразделении ${nodePath} удалено расписание ${post.id}.`,
        });
        return { ok: true, deleted: post.id };
    }
    if (post.toggle === true && post.id) {
        const res = await toggleSchedule({ id: post.id, enabled: post.enabled });
        await recordBossSettingTask(storage, params, {
            title: `${res.enabled ? 'Включено' : 'Приостановлено'} расписание «${res.label || post.id}»`,
            summary: `В подразделении ${nodePath} расписание «${res.label || post.id}» переведено в состояние: ${res.enabled ? 'активно' : 'пауза'}.`,
        });
        return res;
    }
    const created = await createSchedule({
        uid,
        task: String(post.task || '').trim(),
        nodePath,
        label: post.label || 'Задача по расписанию',
        prompt: post.prompt,
        rule: post.rule,
        tz: post.tz,
    });
    await recordBossSettingTask(storage, params, {
        title: `Добавлено расписание «${created.label}»`,
        summary: `В подразделении ${nodePath} добавлено расписание «${created.label}» (${created.when})${created.task ? ` на основе задачи ${created.task}` : ''}.`,
    });
    return created;
}

async function saveOwnClassFields(storage, params, patch) {
    const own = await storage.meta_file;
    const text = own ? await own.load({ encoding: 'utf-8', session: params?.session }).catch(() => '') : '';
    const data = text ? (await FS.$class.importScript(String(text))) || {} : {};
    const copy = { ...data, ...patch };
    if (storage.meta_folder?.save_file) {
        await storage.meta_folder.save_file({
            ...params,
            filename: 'class.js',
            post: 'export default ' + FS.$class.toScript(copy),
        });
        storage.meta_folder?.reset?.();
        storage.reset?.();
        if (typeof storage.import === 'function')
            storage.DATA = await storage.import({ reset: true });
        await storage.init;
    }
    else if (storage?.DATA) {
        Object.assign(storage.DATA, patch);
    }
    return copy;
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
    await saveOwnClassFields(storage, params, { proactivity: next });
    await recordBossSettingTask(storage, params, {
        title: 'Изменено поведение агента узла',
        summary: `В подразделении ${storage.path || '/'} обновлены параметры поведения (autoReply=${next.autoReply !== false}, quietDigest=${next.quietDigest !== false}).`,
    });
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

/**
 * Фоновая проверка входящей почты (IMAP) для узлов, у которых настроен хотя бы один ящик с imap.host
 * и не отключён mailAutoRefresh.
 */
export async function runMailAutoRefresh({ nodes = null } = {}) {
    const WORK = globalThis.WORK;
    if (!WORK && !Array.isArray(nodes))
        return [];
    const list = Array.isArray(nodes) ? nodes : [WORK];
    if (!Array.isArray(nodes) && WORK) {
        const collectTargets = async (containerPath) => {
            const c = await WORK.get_item(containerPath).catch(() => null);
            const items = (await c?.items) || [];
            for (const item of items) {
                if (!item || item.id?.[0] === '$') continue;
                list.push(item);
                if (item.type === '$base' || item.type === '$project') {
                    const sub = (await item.items) || [];
                    for (const child of sub) {
                        if (child && child.type === '$structure' && child.id?.[0] !== '$')
                            list.push(child);
                    }
                }
            }
        };
        await collectTargets('/ORGANIZATIONS');
        await collectTargets('/PROJECTS');
        await collectTargets('/USERS');
    }

    const { readEmailSettings } = await import('../../../$server/$folder/lib/email/settings.js');
    const MAILCAL = await import('../../server/class/mail-calendar.js');
    const refreshed = [];
    for (const nodeItem of list) {
        if (!nodeItem || nodeItem.DATA?.mailAutoRefresh === false)
            continue;
        const settings = readEmailSettings(nodeItem);
        const hasImap = Object.values(settings?.mailboxes || {}).some(b => b?.imap?.host && b?.auth?.pass);
        if (!hasImap)
            continue;
        try {
            const res = await MAILCAL.mailRefresh(nodeItem, { session: { uid: nodeItem.id || 'WORK', $user: WORK } });
            refreshed.push({ path: nodeItem.path || '/', ok: Boolean(res?.ok !== false) });
        }
        catch (e) {
            console.warn('[mailAutoRefresh]', nodeItem.path || '/', e?.message || e);
        }
    }
    return refreshed;
}

/**
 * Зафиксировать настройку руководителя как выполненную задачу `.task` в журнале узла (без вызова LLM).
 */
export async function recordBossSettingTask(storage, params = {}, { title = 'Настройка узла', summary = '' } = {}) {
    if (!storage || params?.skipAuditTask)
        return null;
    try {
        const actor = storage.constructor?.resolveUid?.(params) || params?.session?.uid || 'BOSS';
        const now = Date.now();
        const taskBody = {
            name: String(title || 'Настройка узла').slice(0, 120),
            title: String(title || 'Настройка узла').slice(0, 120),
            status: 'done',
            source: 'boss-setting',
            actor,
            nodePath: storage.path || '/',
            created: now,
            items: [
                { id: 'u_' + now, type: 'user', content: `[Настройка в «Системе»] ${title}` },
                { id: 'a_' + now, type: 'assistant', content: summary || title },
            ],
        };
        if (typeof storage.save_file === 'function') {
            const filename = `setting-${new Date(now).toISOString().replace(/[:.]/g, '-')}.task`;
            const safeParams = {
                ...params,
                session: { ...(params?.session || { uid: actor, $user: globalThis.WORK }), trigger: 'boss-setting' },
                filename,
                post: JSON.stringify(taskBody, null, 2),
                auto: false,
            };
            await storage.save_file(safeParams).catch(() => {});
        }
        return { ok: true, title };
    }
    catch {
        return null;
    }
}

/**
 * Прочитать собственную инструкцию узла (`$structure/ai/system.md`) и унаследованные слои сверху.
 */
export async function getNodeAgentSystem(storage, params = {}) {
    await assertBoss(storage, params);
    const metaDir = storage?.meta_folder?.real_dir || storage?.meta_folder?.dir
        || (storage?.real_dir ? path.join(storage.real_dir, storage.type || '$class') : '');
    const ownFile = metaDir ? path.join(metaDir, 'ai', 'system.md') : '';
    let ownText = '';
    let replace = false;
    if (ownFile && fs.existsSync(ownFile)) {
        try {
            const raw = await fsp.readFile(ownFile, 'utf8');
            const parsed = parseFrontmatter(raw);
            ownText = String(parsed.body || '').trim();
            replace = parsed.meta?.replace === true || parsed.meta?.replace === 'true';
        }
        catch { /* ignore */ }
    }
    const inherited = [];
    try {
        const dirs = await aiDirs(storage);
        const ownPath = storage?.path || '/';
        for (const { dir, scope } of dirs) {
            if (scope === ownPath)
                continue;
            const f = await dir.get_item('system.md').catch(() => null);
            const raw = f && typeof f.load === 'function' ? await f.load({ encoding: 'utf-8' }).catch(() => '') : '';
            const text = String(raw || '').trim();
            if (!text)
                continue;
            const parsed = parseFrontmatter(text);
            inherited.push({
                scope: scope === 'engine' ? 'Базовые правила системы WORK' : scope,
                text: String(parsed.body || text).trim(),
                replace: parsed.meta?.replace === true || parsed.meta?.replace === 'true',
            });
        }
    }
    catch { /* ignore */ }
    return { text: ownText, replace, inherited };
}

/**
 * Сохранить собственную инструкцию агента узла (`$structure/ai/system.md`).
 */
export async function saveNodeAgentSystem(storage, params = {}) {
    await assertBoss(storage, params);
    const post = (typeof params.post === 'string' ? JSON.parse(params.post) : params.post) || params;
    const text = String(post.text ?? '').trim();
    const replace = Boolean(post.replace);
    const metaDir = storage?.meta_folder?.real_dir || storage?.meta_folder?.dir
        || (storage?.real_dir ? path.join(storage.real_dir, storage.type || '$class') : '');
    if (!metaDir)
        throw new Error('Не найдена метапапка узла');
    const filePath = path.join(metaDir, 'ai', 'system.md');
    if (!text && !replace) {
        if (fs.existsSync(filePath))
            await fsp.rm(filePath, { force: true });
    }
    else {
        await fsp.mkdir(path.dirname(filePath), { recursive: true });
        const content = replace ? `---\nreplace: true\n---\n${text}\n` : `${text}\n`;
        await fsp.writeFile(filePath, content, 'utf8');
    }
    storage?.meta_folder?.reset?.();
    storage?.reset?.();
    audit('agent_system_save', { point: storage.path, replace, length: text.length, params });
    await recordBossSettingTask(storage, params, {
        title: 'Обновлена инструкция агента узла',
        summary: text
            ? `Для подразделения ${storage.path || '/'} сохранена инструкция поведения агента (${replace ? 'с заменой общих правил' : 'в дополнение к общим правилам'}):\n${text.slice(0, 300)}`
            : `Для подразделения ${storage.path || '/'} собственная инструкция агента очищена (действуют общие правила).`,
    });
    return { ok: true, text, replace };
}

const DATA_CLASS_TYPES = new Set(['$catalog', '$virtual', '$operation', '$register', '$account', '$struct']);

/**
 * Дерево доступных прикладных классов (из всех модулей текущей организации/проекта и общих /MODULES).
 */
export async function listNodeAvailableClasses(storage, params = {}) {
    await assertBoss(storage, params);
    const WORK = globalThis.WORK;
    if (!WORK)
        return { roots: [] };

    const p = String(storage?.path || '/');
    const m = /^(\/(?:ORGANIZATIONS|PROJECTS)\/[^/]+)/.exec(p);
    const baseModPath = m ? m[1] + '/MODULES' : '';
    const candidateRoots = [];
    if (baseModPath)
        candidateRoots.push({ path: baseModPath, label: 'Модули организации' });
    candidateRoots.push({ path: '/MODULES', label: 'Общие модули системы' });

    const walk = async (node, depth = 0, modRootPath = '') => {
        if (!node || depth > 6)
            return null;
        await node.init?.catch?.(() => {});
        if (!node.id || node.id[0] === '$')
            return null;
        const t = node.type;
        const isLeafData = DATA_CLASS_TYPES.has(t);
        const isFolderGroup = t === '$domain' || t === '$module' || t === '$class' || t === '$folder';
        if (!isLeafData && !isFolderGroup)
            return null;
        const items = await Promise.resolve(node.items).catch(() => []) || [];
        const children = [];
        for (const ch of items) {
            if (!ch || ch.id?.[0] === '$')
                continue;
            const childNode = await walk(ch, depth + 1, modRootPath);
            if (childNode)
                children.push(childNode);
        }
        if (!isLeafData && !children.length)
            return null;
        const rawShort = modRootPath && node.path?.startsWith(modRootPath + '/')
            ? node.path.slice(modRootPath.length + 1)
            : (node.path || node.id);
        return {
            id: node.id,
            path: node.path,
            label: node.DATA?.label || node.label || node.id,
            type: t,
            icon: node.icon || node.DATA?.icon || (isLeafData ? 'odant:class' : 'odant:folder'),
            selectable: isLeafData || t === '$module',
            shortPath: rawShort,
            children,
        };
    };

    const roots = [];
    const seenPaths = new Set();
    for (const r of candidateRoots) {
        if (seenPaths.has(r.path))
            continue;
        seenPaths.add(r.path);
        const modRoot = await WORK.get_item(r.path).catch(() => null);
        if (!modRoot)
            continue;
        const items = await Promise.resolve(modRoot.items).catch(() => []) || [];
        const children = [];
        for (const ch of items) {
            if (!ch || ch.id?.[0] === '$')
                continue;
            const built = await walk(ch, 1, r.path);
            if (built)
                children.push(built);
        }
        if (children.length) {
            roots.push({
                id: r.path,
                path: r.path,
                label: r.label,
                type: '$domain',
                icon: 'odant:folder',
                selectable: false,
                children,
            });
        }
    }
    return { roots };
}

/**
 * Список подразделений текущей организации/проекта (для добавления в участники ролей).
 */
export async function listNodeStructures(storage, params = {}) {
    await assertBoss(storage, params);
    const WORK = globalThis.WORK;
    if (!WORK)
        return { structures: [] };
    const selfPath = String(storage?.path || '/').replace(/\/+$/, '') || '/';
    const m = /^(\/(?:ORGANIZATIONS|PROJECTS)\/[^/]+)/.exec(selfPath);
    const rootsToScan = m ? [m[1]] : ['/ORGANIZATIONS', '/PROJECTS'];
    const out = [];
    const seen = new Set();
    const visit = async (node, depth = 0) => {
        if (!node || depth > 5)
            return;
        await node.init?.catch?.(() => {});
        const p = String(node.path || '').replace(/\/+$/, '') || '/';
        if (['$base', '$project', '$structure'].includes(node.type) && p !== selfPath && !seen.has(p)) {
            seen.add(p);
            out.push({
                path: p,
                id: node.id,
                label: node.DATA?.label || node.label || node.id,
                type: node.type,
                icon: node.icon || node.DATA?.icon || 'odant:structure',
            });
        }
        const items = await Promise.resolve(node.items).catch(() => []) || [];
        for (const ch of items) {
            if (!ch || ch.id?.[0] === '$')
                continue;
            await ch.init?.catch?.(() => {});
            if (['$domain', '$base', '$project', '$structure'].includes(ch.type))
                await visit(ch, depth + 1);
        }
    };
    for (const rp of rootsToScan) {
        const item = await WORK.get_item(rp).catch(() => null);
        if (item)
            await visit(item, 0);
    }
    return { structures: out };
}

/**
 * Список серверов сети WORK (/NODES/<Узел>) для назначения в роли доступа.
 */
export async function listNodeNetworkNodes(storage, params = {}) {
    await assertBoss(storage, params);
    const WORK = globalThis.WORK;
    if (!WORK)
        return { nodes: [] };
    const nodesRoot = await WORK.get_item('/NODES').catch(() => null);
    if (!nodesRoot)
        return { nodes: [] };
    const items = await Promise.resolve(nodesRoot.items).catch(() => []) || [];
    const out = [];
    for (const n of items) {
        if (!n || n.id?.[0] === '$' || n.type !== '$node')
            continue;
        await n.init?.catch?.(() => {});
        const principalId = String(n.principalId || n.DATA?.host_id || n.id || '').trim();
        if (!principalId)
            continue;
        out.push({
            id: n.id,
            path: n.path || `/NODES/${n.id}`,
            principalId,
            label: n.DATA?.label || n.label || n.id,
            origin: n.DATA?.origin || '',
            status: n.DATA?.status || '',
            icon: n.DATA?.icon || n.icon || 'icons:dns',
        });
    }
    return { nodes: out };
}

/**
 * Единый контекст для вкладки «Пользователи» и «Классы и модули» подразделения / $base:
 * реальные пользователи, подразделения, серверы сети, унаследованный BOSS,
 * полное дерево классов вышестоящего $base и доступные модули /MODULES.
 */
export async function getNodeStaffContext(storage, params = {}) {
    await assertBoss(storage, params);
    const WORK = globalThis.WORK;
    if (!WORK)
        return { users: [], structures: [], networkNodes: [], inheritedBoss: null, baseClasses: [], systemModules: [], basePath: '' };

    // 1. Пользователи /USERS (плоский список + иерархия, если есть подпапки)
    const users = [];
    const usersTree = [];
    const userMap = new Map();
    const uRoot = (await WORK.get_item('/USERS').catch(() => null)) || (await WORK.get_item('/users').catch(() => null));
    const walkUsers = async (container, depth = 0) => {
        if (!container || depth > 4)
            return [];
        const items = await Promise.resolve(container.items).catch(() => []) || [];
        const out = [];
        for (const u of items) {
            if (!u?.id || u.id[0] === '$')
                continue;
            await u.init?.catch?.(() => {});
            const t = u.type;
            if (t === '$user' || (!t && !u.items)) {
                const entry = {
                    id: u.id,
                    path: u.path || `/USERS/${u.id}`,
                    type: '$user',
                    label: u.DATA?.label || u.label || u.id,
                    icon: u.DATA?.icon || u.icon || '',
                    iconColor: u.iconColor || '',
                    children: [],
                };
                users.push({ id: entry.id, label: entry.label, icon: entry.icon, iconColor: entry.iconColor });
                userMap.set(entry.id, entry);
                out.push(entry);
            }
            else if (['$domain', '$folder', '$group', '$structure'].includes(t)) {
                const children = await walkUsers(u, depth + 1);
                if (children.length) {
                    out.push({
                        id: u.id,
                        path: u.path || '',
                        type: t,
                        label: u.DATA?.label || u.label || u.id,
                        icon: u.DATA?.icon || u.icon || 'odant:folder',
                        iconColor: '',
                        children,
                    });
                }
            }
        }
        return out;
    };
    if (uRoot)
        usersTree.push(...await walkUsers(uRoot, 0));

    // 2. Унаследованный руководитель (BOSS) вверх по дереву (включая корень '/')
    let inheritedBoss = null;
    try {
        const chain = [];
        for (let anc = storage?.$parent; anc; anc = anc.$parent) {
            if (anc instanceof FS.$class)
                chain.push(anc);
        }
        if (!chain.some(a => a === WORK || a.path === '/'))
            chain.push(WORK);
        for (const anc of chain) {
            await anc.init?.catch?.(() => {});
            const localIds = typeof anc._roleIds === 'function'
                ? anc._roleIds('BOSS')
                : (Array.isArray(anc.DATA?.['#security']?.BOSS) ? anc.DATA['#security'].BOSS : []);
            const cleanIds = (Array.isArray(localIds) ? localIds : []).filter(v => typeof v === 'string' && v.trim());
            if (cleanIds.length) {
                const resolved = cleanIds.slice(0, 1).map(uid => {
                    const found = userMap.get(uid);
                    return found
                        ? { id: found.id, label: found.label, icon: found.icon, iconColor: found.iconColor, missing: false }
                        : { id: uid, label: `${uid} (не найден в /USERS)`, icon: 'icons:person', iconColor: '', missing: true };
                });
                const ancPath = anc.path || '/';
                inheritedBoss = {
                    fromPath: ancPath,
                    fromLabel: anc.DATA?.label || anc.label || anc.id || (ancPath === '/' ? 'WORK' : ancPath),
                    users: resolved,
                };
                break;
            }
        }
    }
    catch { /* ignore */ }

    // 3. Подразделения (деревья /ORGANIZATIONS и /PROJECTS + плоский structures) и серверы сети
    const selfPath = String(storage?.path || '/').replace(/\/+$/, '') || '/';
    const flatStructures = [];
    const seenStructPaths = new Set();
    const walkStructureDomain = async (domainPath) => {
        const rootNode = await WORK.get_item(domainPath).catch(() => null);
        if (!rootNode)
            return [];
        const visit = async (node, depth = 0) => {
            if (!node || depth > 5)
                return null;
            await node.init?.catch?.(() => {});
            if (!node.id || node.id[0] === '$')
                return null;
            if (!['$base', '$project', '$structure'].includes(node.type))
                return null;
            // Проверяем видимость для текущего пользователя (не показываем чужие скрытые организации)
            if (typeof node.canSee === 'function') {
                const ok = await node.canSee(node, params).catch(() => false);
                if (!ok)
                    return null;
            }
            const p = String(node.path || '').replace(/\/+$/, '') || '/';
            const entry = {
                id: node.id,
                path: p,
                label: node.DATA?.label || node.label || node.id,
                type: node.type,
                icon: node.DATA?.icon || node.icon || (node.type === '$base' ? 'odant:base' : node.type === '$project' ? 'odant:project' : 'odant:structure'),
                isSelf: p === selfPath,
                children: [],
            };
            if (p !== selfPath && !seenStructPaths.has(p)) {
                seenStructPaths.add(p);
                flatStructures.push({ path: p, id: entry.id, label: entry.label, type: entry.type, icon: entry.icon });
            }
            const items = await Promise.resolve(node.items).catch(() => []) || [];
            for (const ch of items) {
                if (!ch || ch.id?.[0] === '$')
                    continue;
                await ch.init?.catch?.(() => {});
                if (['$base', '$project', '$structure'].includes(ch.type)) {
                    const built = await visit(ch, depth + 1);
                    if (built)
                        entry.children.push(built);
                }
            }
            return entry;
        };
        const items = await Promise.resolve(rootNode.items).catch(() => []) || [];
        const res = [];
        for (const ch of items) {
            if (!ch || ch.id?.[0] === '$')
                continue;
            const built = await visit(ch, 0);
            if (built)
                res.push(built);
        }
        return res;
    };
    const [organizationsTree, projectsTree, netRes] = await Promise.all([
        walkStructureDomain('/ORGANIZATIONS').catch(() => []),
        walkStructureDomain('/PROJECTS').catch(() => []),
        listNodeNetworkNodes(storage, params).catch(() => ({ nodes: [] })),
    ]);

    // 4. Полное дерево всех классов, установленных в вышестоящий $base ($project)
    const baseMatch = /^(\/(?:ORGANIZATIONS|PROJECTS)\/[^/]+)/.exec(selfPath);
    const basePath = baseMatch ? baseMatch[1] : '';
    const modRootPath = basePath ? `${basePath}/MODULES` : '/MODULES';
    const baseClasses = [];
    const installedModIds = new Set();

    const walkClasses = async (node, depth = 0) => {
        if (!node || depth > 7)
            return null;
        await node.init?.catch?.(() => {});
        if (!node.id || node.id[0] === '$')
            return null;
        const t = node.type;
        const isAllowed = DATA_CLASS_TYPES.has(t) || t === '$module' || t === '$domain' || t === '$class' || t === '$folder';
        if (!isAllowed)
            return null;
        if (t === '$module')
            installedModIds.add(node.id);
        const items = await Promise.resolve(node.items).catch(() => []) || [];
        const children = [];
        for (const ch of items) {
            if (!ch || ch.id?.[0] === '$')
                continue;
            const built = await walkClasses(ch, depth + 1);
            if (built)
                children.push(built);
        }
        children.sort(compareTreeLabels);
        return {
            id: node.id,
            path: node.path,
            label: node.DATA?.label || node.label || node.id,
            type: t,
            icon: node.DATA?.icon || node.icon || (t === '$module' ? 'odant:module' : 'odant:class'),
            children,
        };
    };

    const modRootItem = await WORK.get_item(modRootPath).catch(() => null);
    if (modRootItem) {
        const modKids = await Promise.resolve(modRootItem.items).catch(() => []) || [];
        for (const mk of modKids) {
            if (!mk || mk.id?.[0] === '$')
                continue;
            const built = await walkClasses(mk, 0);
            if (built)
                baseClasses.push(built);
        }
    }
    baseClasses.sort(compareTreeLabels);

    // 5. Доступные эталонные модули в корневом /MODULES
    const systemModules = [];
    const sysModRoot = await WORK.get_item('/MODULES').catch(() => null);
    if (sysModRoot) {
        const sysKids = await Promise.resolve(sysModRoot.items).catch(() => []) || [];
        for (const sm of sysKids) {
            if (!sm || sm.id?.[0] === '$' || sm.type !== '$module')
                continue;
            await sm.init?.catch?.(() => {});
            systemModules.push({
                id: sm.id,
                path: sm.path,
                label: sm.DATA?.label || sm.label || sm.id,
                icon: sm.DATA?.icon || sm.icon || 'odant:module',
                installed: installedModIds.has(sm.id),
            });
        }
    }

    return {
        users,
        usersTree,
        structures: flatStructures,
        organizationsTree,
        projectsTree,
        networkNodes: netRes.nodes || [],
        inheritedBoss,
        basePath,
        modRootPath,
        baseClasses,
        systemModules,
    };
}

/**
 * Подключить эталонный модуль из `/MODULES/<id>` в `<$base>/MODULES`.
 */
export async function installBaseModule(storage, params = {}) {
    await assertBoss(storage, params);
    const post = (typeof params.post === 'string' ? JSON.parse(params.post) : params.post) || params;
    const modId = String(post.moduleId || post.id || '').trim();
    if (!modId || /[\\/.$#]/.test(modId))
        throw new Error('Укажите корректный идентификатор модуля');
    const selfPath = String(storage?.path || '/').replace(/\/+$/, '') || '/';
    const baseMatch = /^(\/(?:ORGANIZATIONS|PROJECTS)\/[^/]+)/.exec(selfPath);
    if (!baseMatch)
        throw new Error('Подключение модулей выполняется в контексте организации или проекта');
    const baseItem = await globalThis.WORK.get_item(baseMatch[1]).catch(() => null);
    if (!baseItem)
        throw new Error('Не найден корневой объект организации');
    let modDomain = await globalThis.WORK.get_item(`${baseMatch[1]}/MODULES`).catch(() => null);
    if (!modDomain && typeof baseItem.create === 'function') {
        await baseItem.create({ ...params, id: 'MODULES', type: '$domain', label: 'Модули' });
        modDomain = await globalThis.WORK.get_item(`${baseMatch[1]}/MODULES`).catch(() => null);
    }
    if (!modDomain)
        throw new Error('Не найден домен MODULES');
    const exists = await globalThis.WORK.get_item(`${baseMatch[1]}/MODULES/${modId}`).catch(() => null);
    if (exists)
        return { ok: true, alreadyInstalled: true, path: exists.path };
    await modDomain.create({ ...params, id: modId, type: '$module' });
    await recordBossSettingTask(storage, params, {
        title: `Подключён модуль «${modId}»`,
        summary: `В ${baseMatch[1]} подключён модуль /MODULES/${modId}.`,
    });
    return { ok: true, path: `${baseMatch[1]}/MODULES/${modId}` };
}

/**
 * Создать новый класс или подкласс внутри `<$base>/MODULES`.
 */
export async function createBaseClass(storage, params = {}) {
    await assertBoss(storage, params);
    const post = (typeof params.post === 'string' ? JSON.parse(params.post) : params.post) || params;
    const parentPath = String(post.parentPath || '').trim();
    const id = String(post.id || post.label || '').trim();
    const label = String(post.label || id).trim();
    const type = String(post.type || '$catalog').trim();
    if (!id)
        throw new Error('Укажите название класса');
    const selfPath = String(storage?.path || '/').replace(/\/+$/, '') || '/';
    const baseMatch = /^(\/(?:ORGANIZATIONS|PROJECTS)\/[^/]+)/.exec(selfPath);
    if (!baseMatch)
        throw new Error('Создание класса выполняется в контексте организации или проекта');
    const modPrefix = `${baseMatch[1]}/MODULES`;
    const targetParentPath = parentPath && parentPath.startsWith(modPrefix) ? parentPath : modPrefix;
    const parentItem = await globalThis.WORK.get_item(targetParentPath).catch(() => null);
    if (!parentItem || typeof parentItem.create !== 'function')
        throw new Error('Не найден родительский контейнер: ' + targetParentPath);
    await parentItem.create({ ...params, id, label, type });
    await recordBossSettingTask(storage, params, {
        title: `Создан класс «${label}» (${type})`,
        summary: `В ${targetParentPath} создан класс «${label}» типа ${type}.`,
    });
    return { ok: true, path: `${targetParentPath}/${id}` };
}

/**
 * Последние выполненные задачи `.task` подразделения (для повторения по расписанию).
 */
export async function listNodeTasks(storage, params = {}) {
    await assertBoss(storage, params);
    const out = [];
    const seen = new Set();
    const scanContainer = async (container) => {
        if (!container)
            return;
        const items = await Promise.resolve(container.items).catch(() => []) || [];
        for (const f of items) {
            if (!(f instanceof FS.$file) || !String(f.id || '').endsWith('.task') || seen.has(f.path))
                continue;
            seen.add(f.path);
            try {
                const raw = await f.load({ encoding: 'utf-8' }).catch(() => '');
                const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
                if (!parsed || parsed.source === 'boss-setting')
                    continue;
                const firstUser = Array.isArray(parsed.items) ? parsed.items.find(i => i?.type === 'user' && i.content) : null;
                const prompt = String(firstUser?.content || parsed.prompt || parsed.name || '').trim();
                if (!prompt)
                    continue;
                out.push({
                    path: f.path,
                    title: String(parsed.title || parsed.name || f.id.replace(/\.task$/i, '')).slice(0, 100),
                    prompt: prompt.slice(0, 1000),
                    time: Number(parsed.updated || parsed.created || f.mtime || 0),
                });
            }
            catch { /* ignore */ }
        }
    };
    await scanContainer(storage);
    const uid = storage.constructor?.resolveUid?.(params) || params?.session?.uid || '';
    if (uid && globalThis.WORK) {
        const userItem = await globalThis.WORK.get_item(`/USERS/${uid}`).catch(() => null);
        await scanContainer(userItem);
    }
    out.sort((a, b) => (b.time || 0) - (a.time || 0));
    return { tasks: out.slice(0, 30) };
}

/**
 * Сохранить `#security` подразделения (BOSS — не более одного, ROLES — роли с людьми/подразделениями и классами)
 * с автоматической фиксацией в журнале босса.
 */
export async function saveNodeSecurity(storage, params = {}) {
    await assertBoss(storage, params);
    const post = (typeof params.post === 'string' ? JSON.parse(params.post) : params.post) || params;
    const rawSec = post.security && typeof post.security === 'object' ? post.security : post;
    const bossArr = Array.isArray(rawSec.BOSS)
        ? rawSec.BOSS.filter(v => typeof v === 'string' && v.trim()).slice(0, 1)
        : [];
    const nextSec = {
        ...rawSec,
        BOSS: bossArr,
    };
    await saveOwnClassFields(storage, params, { '#security': nextSec });
    try {
        const LINKS = await import('../../server/access/links.js');
        LINKS.reset();
    }
    catch { /* ignore */ }
    const summaryText = String(post.summary || '').trim()
        || `Обновлена структура прав в ${storage.path || '/'}: BOSS=${bossArr[0] || 'наследуется сверху'}, ролей=${Array.isArray(nextSec.ROLES) ? nextSec.ROLES.length : 0}.`;
    await recordBossSettingTask(storage, params, {
        title: String(post.title || 'Изменены права и роли подразделения'),
        summary: summaryText,
    });
    storage.meta_folder?.reset?.();
    storage.reset?.();
    if (typeof storage.import === 'function')
        storage.DATA = await storage.import({ reset: true });
    await storage.init;
    return { ok: true, security: nextSec };
}
