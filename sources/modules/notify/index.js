/**
 * Модуль каналов уведомлений в мессенджеры Telegram и MAX (`sources/modules/notify/index.js`).
 *
 * Архитектура:
 *  1. Боты привязываются к точкам оргмодели (`$structure`, `$base`, `$server`, `$user`)
 *     в `<meta_folder>/#secret/messengers.json` (шифрование `secret-box.js`).
 *  2. Если у точки нет собственного бота, используется бот вышестоящей точки по цепочке
 *     `$parent` вплоть до `$base` и `$server` (`resolveBotForPoint`).
 *  3. Пользователи формально связаны с подразделениями через `#security` (`BOSS`, `ADMIN`, `USER`, `ROLES`).
 *     Личный `chat_id` пользователя привязывается по одноразовому коду `/start <CODE>` и хранится
 *     в `USERS/<uid>/$user/#secret/messengers.json`.
 *  4. Поддерживаются два режима доставки от подразделения:
 *     - персональные уведомления конкретному участнику (`notifyPersonal`);
 *     - общие уведомления подразделения (`notifyDepartment`) — в групповой чат точки (`groupChatId`)
 *       и/или веером всем формально привязанным к подразделению пользователям, с fallback на браузерный web-push.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as SB from '../../host/secret-box.js';
import * as WORKPLACES from '../../server/access/workplaces.js';
import * as TG from './telegram.js';
import * as MAX from './max.js';

export { TG as telegramAdapter, MAX as maxAdapter };

export const ADAPTERS = {
    telegram: TG,
    max: MAX,
};

export const LINK_CODE_TTL_MS = 15 * 60_000;
const POLL_INTERVAL_MS = 5_000;

/** Одноразовые коды привязки: code -> { code, target: 'user'|'group', uid, pointPath, channel, botId, expiresAt } */
const PENDING_CODES = new Map();

/** Курсоры getUpdates по ключу `${kind}:${token}` -> nextOffset */
const UPDATE_OFFSETS = new Map();

/** Обнаруженные групповые чаты по ключу бота `${kind}:${botId}` -> Map<chatId, { chatId, title, channel, seenAt }> */
const DISCOVERED_GROUPS = new Map();

export function getAdapter(kind = 'telegram') {
    const k = String(kind || 'telegram').toLowerCase();
    const adapter = ADAPTERS[k];
    if (!adapter)
        throw new Error(`Неизвестный мессенджер: ${kind} (поддерживаются telegram, max)`);
    return adapter;
}

export function maskToken(token = '') {
    const s = String(token || '').trim();
    if (!s)
        return '';
    if (s.length <= 10)
        return s.slice(0, 2) + '***' + s.slice(-2);
    return s.slice(0, 6) + '***' + s.slice(-4);
}

function isMaskedOrEmpty(token = '') {
    const s = String(token || '').trim();
    return !s || s.includes('***');
}

function normalizeBotEntry(raw, fallbackId = 'bot_default') {
    if (!raw || typeof raw !== 'object')
        return null;
    const kind = String(raw.kind || 'telegram').toLowerCase() === 'max' ? 'max' : 'telegram';
    const token = String(raw.token || '').trim();
    const id = String(raw.id || fallbackId).trim() || fallbackId;
    const label = String(raw.label || (kind === 'max' ? 'MAX Бот' : 'Telegram Бот')).trim();
    const username = String(raw.username || '').replace(/^@/, '').trim();
    const apiUrl = String(raw.apiUrl || '').trim();
    const enabled = raw.enabled !== false;
    return { id, kind, label, token, username, apiUrl, enabled };
}

export function normalizePointConfig(raw = {}) {
    if (!raw || typeof raw !== 'object')
        raw = {};
    const bot = raw.bot ? normalizeBotEntry(raw.bot, raw.bot.id || 'bot_point') : null;
    const bots = Array.isArray(raw.bots)
        ? raw.bots.map((b, i) => normalizeBotEntry(b, `bot_${i + 1}`)).filter(Boolean)
        : [];
    return {
        bot: bot && (bot.token || bot.label || bot.username) ? bot : null,
        botId: String(raw.botId || '').trim(),
        bots,
        groupChatId: String(raw.groupChatId || '').trim(),
        groupTitle: String(raw.groupTitle || '').trim(),
        groupKind: String(raw.groupKind || '').trim(),
        broadcastToMembers: raw.broadcastToMembers !== false,
        notifySchedule: raw.notifySchedule !== false,
        notifyTasks: raw.notifyTasks !== false,
    };
}

/** Определить путь на диске к `#secret/messengers.json` для точки ($structure / $base / $server / $user). */
export function pointSecretPaths(point) {
    const root = process.cwd();
    if (!point)
        return { secret: path.join(root, '$server', '#secret', 'messengers.json'), legacy: path.join(root, '#system', 'messengers.json'), aad: '/' };

    if (typeof point === 'object' && point.meta_folder?.dir) {
        const dir = point.meta_folder.dir;
        const p = point.path || '/';
        return {
            secret: path.join(dir, '#secret', 'messengers.json'),
            legacy: path.join(dir, '#system', 'messengers.json'),
            aad: p,
        };
    }

    const rel = String(typeof point === 'string' ? point : (point.path || '')).replace(/^\/+/, '').replace(/\/+$/, '');
    if (!rel) {
        return {
            secret: path.join(root, '$server', '#secret', 'messengers.json'),
            legacy: path.join(root, '#system', 'messengers.json'),
            aad: '/',
        };
    }

    const abs = path.join(root, rel);
    let metaName = '$structure';
    if (fs.existsSync(abs)) {
        try {
            const found = fs.readdirSync(abs).find(f => f[0] === '$' && fs.statSync(path.join(abs, f)).isDirectory());
            if (found)
                metaName = found;
        }
        catch { /* fallback */ }
    }
    else if (rel.startsWith('USERS/')) {
        metaName = '$user';
    }
    else if (/^ORGANIZATIONS\/[^/]+$/.test(rel)) {
        metaName = '$base';
    }

    return {
        secret: path.join(abs, metaName, '#secret', 'messengers.json'),
        legacy: path.join(abs, metaName, '#system', 'messengers.json'),
        aad: '/' + rel,
    };
}

function extractSecurityFromClassJs(text = '') {
    const idx = text.indexOf('#security');
    if (idx < 0)
        return null;
    const braceStart = text.indexOf('{', idx);
    if (braceStart < 0)
        return null;
    let depth = 0;
    let inStr = '';
    let esc = false;
    for (let i = braceStart; i < text.length; i++) {
        const ch = text[i];
        if (esc) {
            esc = false;
            continue;
        }
        if (ch === '\\') {
            esc = true;
            continue;
        }
        if (inStr) {
            if (ch === inStr)
                inStr = '';
            continue;
        }
        if (ch === '"' || ch === "'" || ch === '`') {
            inStr = ch;
            continue;
        }
        if (ch === '{')
            depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) {
                const slice = text.slice(braceStart, i + 1);
                try { return JSON.parse(slice); } catch { /* fallback */ }
                try { return new Function('return (' + slice + ')')(); } catch { return null; }
            }
        }
    }
    return null;
}

function readDiskPointMeta(pointPath) {
    const root = process.cwd();
    const rel = String(pointPath || '').replace(/^\/+/, '');
    if (!rel)
        return { label: 'WORK', sec: null };
    const absDir = path.join(root, rel);
    if (!fs.existsSync(absDir))
        return { label: rel.split('/').pop() || 'WORK', sec: null };
    try {
        const metaDir = fs.readdirSync(absDir).find(f => f[0] === '$' && fs.statSync(path.join(absDir, f)).isDirectory());
        const clsFile = metaDir ? path.join(absDir, metaDir, 'class.js') : null;
        if (clsFile && fs.existsSync(clsFile)) {
            const text = fs.readFileSync(clsFile, 'utf-8');
            const lm = text.match(/["']?label["']?\s*:\s*["']([^"']+)["']/);
            return {
                label: lm ? lm[1] : (rel.split('/').pop() || 'WORK'),
                sec: extractSecurityFromClassJs(text),
            };
        }
    }
    catch { /* ignore */ }
    return { label: rel.split('/').pop() || 'WORK', sec: null };
}

const POINT_BOX = aad => ({ info: 'work-messengers-point', aad: String(aad || '/') });
const USER_BOX = uid => ({ info: 'work-messengers-user', aad: String(uid || '') });

async function readSealedOrPlain(filePath, boxCtx) {
    if (!filePath || !fs.existsSync(filePath))
        return null;
    let parsed;
    try {
        parsed = JSON.parse(await fs.promises.readFile(filePath, 'utf-8'));
    }
    catch {
        return null;
    }
    if (!SB.isSealed(parsed))
        return parsed;
    const { value } = await SB.open(parsed, boxCtx);
    return value;
}

async function writeSealed(filePath, value, boxCtx) {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    const sealed = await SB.seal(value, boxCtx);
    const tmp = filePath + '.tmp.' + process.pid + '.' + Date.now();
    await fs.promises.writeFile(tmp, JSON.stringify(sealed, null, 2), 'utf-8');
    await fs.promises.rename(tmp, filePath);
}

/** Прочитать конфигурацию мессенджеров точки (с расшифровкой). */
export async function readPointConfig(point) {
    const paths = pointSecretPaths(point);
    const box = POINT_BOX(paths.aad);
    for (const p of [paths.secret, paths.legacy]) {
        try {
            const data = await readSealedOrPlain(p, box);
            if (data)
                return normalizePointConfig(data);
        }
        catch (e) {
            console.warn('[notify] readPointConfig:', e.message);
        }
    }
    return normalizePointConfig({});
}

/** Сохранить конфигурацию мессенджеров точки (сохраняя существующий токен, если пришёл маскированный). */
export async function savePointConfig(point, input = {}) {
    const existing = await readPointConfig(point);
    const next = normalizePointConfig({
        ...existing,
        ...input,
    });

    // Если в bot передан маскированный токен или пустой при сохранении метки — оставляем прежний токен
    if (input.bot !== undefined) {
        if (input.bot === null) {
            next.bot = null;
        }
        else {
            const incomingBot = normalizeBotEntry(input.bot, existing.bot?.id || 'bot_' + Date.now().toString(36));
            if (incomingBot && isMaskedOrEmpty(incomingBot.token) && existing.bot?.token)
                incomingBot.token = existing.bot.token;
            if (incomingBot && !incomingBot.username && existing.bot?.username && incomingBot.token === existing.bot?.token)
                incomingBot.username = existing.bot.username;
            next.bot = incomingBot && (incomingBot.token || incomingBot.label) ? incomingBot : null;
        }
    }

    // Аналогично для списка bots (если редактируется реестр ботов на сервере/базе)
    if (Array.isArray(input.bots)) {
        const oldById = new Map((existing.bots || []).map(b => [b.id, b]));
        next.bots = input.bots.map((raw, idx) => {
            const b = normalizeBotEntry(raw, raw?.id || `bot_${idx + 1}`);
            if (!b)
                return null;
            const prev = oldById.get(b.id);
            if (isMaskedOrEmpty(b.token) && prev?.token)
                b.token = prev.token;
            if (!b.username && prev?.username && b.token === prev?.token)
                b.username = prev.username;
            return b;
        }).filter(Boolean);
    }

    const paths = pointSecretPaths(point);
    await writeSealed(paths.secret, next, POINT_BOX(paths.aad));
    return next;
}

/** Публичное представление бота (с маскированным токеном для UI). */
export function sanitizeBotForUi(bot, extra = {}) {
    if (!bot)
        return null;
    return {
        id: bot.id,
        kind: bot.kind || 'telegram',
        label: bot.label || (bot.kind === 'max' ? 'MAX Бот' : 'Telegram Бот'),
        username: bot.username || '',
        apiUrl: bot.apiUrl || '',
        enabled: bot.enabled !== false,
        hasToken: Boolean(bot.token && !isMaskedOrEmpty(bot.token)),
        tokenMask: maskToken(bot.token),
        ...extra,
    };
}

/**
 * Построить цепочку точек от текущей вверх до корня ($structure -> ... -> $base -> $server).
 * Работает как с живыми объектами WORK ($class/$folder/$file), так и со строковыми путями.
 */
export async function buildPointChain(point) {
    const WORK = globalThis.WORK;
    let cur = point;

    if (typeof cur === 'string' && WORK?.get_item) {
        const clean = cur.replace(/\/+$/, '') || '/';
        if (clean === '/') {
            cur = WORK;
        }
        else {
            try {
                const item = await WORK.get_item(clean);
                cur = Array.isArray(item) ? item.at(-1) : item;
            }
            catch { cur = null; }
        }
    }

    // Если передан $file (например .task) или мета-папка — поднимаемся к владельцу $class
    if (cur && typeof cur === 'object') {
        if (cur.$owner && cur.constructor?.name !== '$class' && !cur.meta_folder)
            cur = cur.$owner;
        else if (cur.isMetaFolder && cur.parent)
            cur = cur.parent;
    }

    const chain = [];
    const seenPaths = new Set();
    const pushNode = (node, fallbackPath, fallbackLabel) => {
        const p = (node?.path || fallbackPath || '/').replace(/\/+$/, '') || '/';
        if (seenPaths.has(p))
            return;
        seenPaths.add(p);
        const diskMeta = (!node?.label && !node?.DATA?.label) ? readDiskPointMeta(p) : null;
        chain.push({
            node: node || null,
            path: p,
            label: node?.label || node?.DATA?.label || diskMeta?.label || fallbackLabel || (p === '/' ? 'WORK' : p.split('/').pop()),
            type: node?.type || (p === '/' ? '$server' : ''),
        });
    };

    if (cur && typeof cur === 'object') {
        for (let n = cur; n; n = n.$parent || n.parent) {
            // Пропускаем промежуточные технические папки и домен /ORGANIZATIONS или /USERS, но оставляем $structure/$base/$user/$server
            if (n.isMetaFolder)
                continue;
            const t = n.type || '';
            if (t === '$domain' && n.id !== 'WORK')
                continue;
            pushNode(n, n.path || '/', n.label || n.id);
        }
    }

    // Дополняем по сегментам пути, если передана строка или дерево не дошло до корня
    const rawPath = typeof point === 'string'
        ? point
        : (point?.path || chain[0]?.path || '/');
    const cleanPath = String(rawPath || '/').replace(/\/+$/, '') || '/';
    // Отрезаем хвост внутри метапапки (например /ORGANIZATIONS/Маслоторг/sales/$structure/task/...)
    const metaIdx = cleanPath.split('/').findIndex((seg, idx) => idx > 0 && seg.startsWith('$'));
    const baseSegs = (metaIdx > 0 ? cleanPath.split('/').slice(0, metaIdx) : cleanPath.split('/')).filter(Boolean);

    for (let len = baseSegs.length; len >= 1; len--) {
        const subSegs = baseSegs.slice(0, len);
        if (subSegs.length === 1 && (subSegs[0] === 'ORGANIZATIONS' || subSegs[0] === 'USERS' || subSegs[0] === 'MODULES'))
            continue;
        const p = '/' + subSegs.join('/');
        if (seenPaths.has(p))
            continue;
        let resolvedNode = null;
        if (WORK?.get_item) {
            try {
                const it = await WORK.get_item(p);
                resolvedNode = Array.isArray(it) ? it[0] : it;
            }
            catch { /* ignore */ }
        }
        pushNode(resolvedNode, p, subSegs[subSegs.length - 1]);
    }

    if (!seenPaths.has('/'))
        pushNode(WORK || null, '/', 'WORK');

    return chain;
}

/**
 * Найти эффективного бота для точки с наследованием вверх по цепочке $structure -> $base -> $server.
 * Если у самой точки нет бота, берётся ближайший активный бот вышестоящей точки.
 */
export async function resolveBotForPoint(point) {
    const chain = await buildPointChain(point);
    if (!chain.length)
        return null;

    const configs = [];
    const registryById = new Map();

    for (const entry of chain) {
        const cfg = await readPointConfig(entry.node || entry.path);
        configs.push({ entry, cfg });
        for (const b of cfg.bots || []) {
            if (b?.id && b.token && b.enabled !== false && !registryById.has(b.id))
                registryById.set(b.id, { bot: b, source: entry });
        }
        if (cfg.bot?.id && cfg.bot.token && cfg.bot.enabled !== false && !registryById.has(cfg.bot.id))
            registryById.set(cfg.bot.id, { bot: cfg.bot, source: entry });
    }

    const startEntry = chain[0];
    const ownCfg = configs[0]?.cfg || normalizePointConfig({});

    let chosenBot = null;
    let chosenSource = null;

    for (const { entry, cfg } of configs) {
        if (cfg.bot && cfg.bot.token && cfg.bot.enabled !== false) {
            chosenBot = cfg.bot;
            chosenSource = entry;
            break;
        }
        if (cfg.botId && registryById.has(cfg.botId)) {
            const hit = registryById.get(cfg.botId);
            chosenBot = hit.bot;
            chosenSource = entry;
            break;
        }
        if (cfg.bots?.length) {
            const firstActive = cfg.bots.find(b => b.token && b.enabled !== false);
            if (firstActive) {
                chosenBot = firstActive;
                chosenSource = entry;
                break;
            }
        }
    }

    // Групповой чат: сначала собственный у точки, иначе если у точки не задан — не смешиваем чужие отделы автоматически
    const groupChatId = ownCfg.groupChatId || '';
    const groupTitle = ownCfg.groupTitle || '';

    return {
        bot: chosenBot,
        inherited: Boolean(chosenBot && chosenSource && chosenSource.path !== startEntry.path),
        sourcePath: chosenSource?.path || '',
        sourceLabel: chosenSource?.label || '',
        pointPath: startEntry.path,
        pointLabel: startEntry.label,
        groupChatId,
        groupTitle,
        broadcastToMembers: ownCfg.broadcastToMembers !== false,
        notifySchedule: ownCfg.notifySchedule !== false,
        notifyTasks: ownCfg.notifyTasks !== false,
        availableBots: [...registryById.values()].map(({ bot, source }) => sanitizeBotForUi(bot, {
            sourcePath: source.path,
            sourceLabel: source.label,
        })),
    };
}

/**
 * Получить список uid пользователей, формально привязанных к точке через настройки безопасности (#security).
 * Включает BOSS, ADMIN, USER и всех участников рабочих мест ROLES.
 */
export async function getPointMemberUids(point, { roles = null } = {}) {
    const chain = await buildPointChain(point);
    const target = chain[0];
    if (!target)
        return [];

    // Личный кабинет /USERS/<uid>
    const userMatch = target.path.match(/^\/USERS\/([^/$]+)$/);
    if (userMatch && userMatch[1] !== 'GUEST')
        return [userMatch[1]];

    let sec = null;
    const node = target.node;
    if (node) {
        try {
            await node.init;
            sec = node.DATA?.['#security'] || null;
        }
        catch { /* ignore */ }
    }

    if (!sec) {
        // Fallback: чтение class.js точки с диска
        sec = readDiskPointMeta(target.path).sec;
    }

    if (!sec || typeof sec !== 'object')
        return [];

    const uids = new Set();
    const filterRoles = Array.isArray(roles) && roles.length ? new Set(roles) : null;

    for (const [key, val] of Object.entries(sec)) {
        if (key === 'LINKS' || key === 'ROLES')
            continue;
        if (filterRoles && !filterRoles.has(key))
            continue;
        if (Array.isArray(val)) {
            for (const id of val) {
                if (typeof id === 'string' && id && id !== 'GUEST')
                    uids.add(id);
            }
        }
    }

    if (!filterRoles || filterRoles.has('USER') || filterRoles.has('ROLES')) {
        for (const id of WORKPLACES.placeUserIds(sec)) {
            if (typeof id === 'string' && id && id !== 'GUEST')
                uids.add(id);
        }
    }

    return [...uids];
}

/**
 * Найти все точки ($base / $structure), к которым пользователь формально привязан в #security.
 */
export async function findUserPoints(uid) {
    if (!uid || uid === 'GUEST')
        return [];
    const root = process.cwd();
    const orgsRoot = path.join(root, 'ORGANIZATIONS');
    const results = [];
    if (!fs.existsSync(orgsRoot))
        return results;

    const walk = async (dir, relParts) => {
        let entries;
        try {
            entries = await fs.promises.readdir(dir, { withFileTypes: true });
        }
        catch {
            return;
        }
        const metaEntry = entries.find(e => e.isDirectory() && (e.name === '$base' || e.name === '$structure'));
        if (metaEntry && relParts.length >= 2) {
            const pointPath = '/' + relParts.join('/');
            const members = await getPointMemberUids(pointPath);
            if (members.includes(uid)) {
                results.push({
                    path: pointPath,
                    label: relParts[relParts.length - 1],
                    type: metaEntry.name,
                });
            }
        }
        for (const e of entries) {
            if (!e.isDirectory() || e.name.startsWith('$') || e.name.startsWith('#') || e.name.startsWith('.'))
                continue;
            if (e.name === 'MODULES' || e.name === 'CATALOGS' || e.name === 'OPERATIONS' || e.name === 'REGISTER')
                continue;
            await walk(path.join(dir, e.name), [...relParts, e.name]);
        }
    };

    await walk(orgsRoot, ['ORGANIZATIONS']);
    return results;
}

/**
 * Резолв бота для пользователя с учётом точки события и подразделений, к которым привязан пользователь.
 */
export async function resolveBotForUser(uid, point = null) {
    const rawPointPath = typeof point === 'string' ? point : (point?.path || '');
    const isPersonalPath = !rawPointPath || /^\/?USERS\//i.test(rawPointPath);

    if (point && !isPersonalPath) {
        const res = await resolveBotForPoint(point);
        if (res?.bot)
            return res;
    }

    if (uid) {
        // 1. Собственный бот в личном кабинете пользователя (без провала сразу на '/')
        const userCabinet = `/USERS/${uid}`;
        const cabCfg = await readPointConfig(userCabinet);
        if (cabCfg?.bot?.token && cabCfg.bot.enabled !== false)
            return resolveBotForPoint(userCabinet);

        // 2. Бот подразделения / организации, к которым пользователь привязан через #security
        const userPoints = await findUserPoints(uid);
        for (const p of userPoints) {
            const pRes = await resolveBotForPoint(p.path);
            if (pRes?.bot)
                return pRes;
        }
    }

    if (point) {
        const res = await resolveBotForPoint(point);
        if (res?.bot)
            return res;
    }
    return resolveBotForPoint('/');
}

// ============================================================================
// Привязки личных чатов пользователей (USERS/<uid>/$user/#secret/messengers.json)
// ============================================================================

function userSecretPath(uid) {
    if (!uid || !/^[\w.-]{1,64}$/.test(String(uid)) || String(uid).includes('..'))
        throw new Error('Недопустимый идентификатор пользователя');
    return path.join(process.cwd(), 'USERS', String(uid), '$user', '#secret', 'messengers.json');
}

export async function readUserBindings(uid) {
    try {
        const p = userSecretPath(uid);
        const data = await readSealedOrPlain(p, USER_BOX(uid));
        if (data && typeof data === 'object') {
            return {
                enabled: data.enabled !== false,
                chats: data.chats && typeof data.chats === 'object' ? data.chats : {},
                byBot: data.byBot && typeof data.byBot === 'object' ? data.byBot : {},
            };
        }
    }
    catch (e) {
        console.warn('[notify] readUserBindings:', e.message);
    }
    return { enabled: true, chats: {}, byBot: {} };
}

export async function saveUserBindings(uid, bindings = {}) {
    const clean = {
        enabled: bindings.enabled !== false,
        chats: bindings.chats && typeof bindings.chats === 'object' ? bindings.chats : {},
        byBot: bindings.byBot && typeof bindings.byBot === 'object' ? bindings.byBot : {},
    };
    await writeSealed(userSecretPath(uid), clean, USER_BOX(uid));
    return clean;
}

export async function bindUserChat(uid, { channel = 'telegram', chatId, userId, username = '', firstName = '', botId = '', pointPath = '' } = {}) {
    const kind = String(channel || 'telegram').toLowerCase() === 'max' ? 'max' : 'telegram';
    const cleanChatId = String(chatId ?? '').trim();
    if (!cleanChatId)
        throw new Error('bindUserChat: не указан chatId');
    const bindings = await readUserBindings(uid);
    const record = {
        kind,
        chatId: cleanChatId,
        userId: String(userId || cleanChatId),
        username: String(username || ''),
        firstName: String(firstName || ''),
        botId: String(botId || ''),
        pointPath: String(pointPath || ''),
        linkedAt: Date.now(),
    };
    bindings.chats[kind] = record;
    if (botId)
        bindings.byBot[botId] = record;
    await saveUserBindings(uid, bindings);
    return record;
}

export async function unbindUserChat(uid, { channel = '', botId = '' } = {}) {
    const bindings = await readUserBindings(uid);
    if (botId && bindings.byBot[botId])
        delete bindings.byBot[botId];
    if (channel) {
        const k = String(channel).toLowerCase();
        delete bindings.chats[k];
        for (const [bId, rec] of Object.entries(bindings.byBot)) {
            if (rec?.kind === k)
                delete bindings.byBot[bId];
        }
    }
    else if (!botId) {
        bindings.chats = {};
        bindings.byBot = {};
    }
    await saveUserBindings(uid, bindings);
    return bindings;
}

// ============================================================================
// Одноразовые коды привязки (/start <CODE>) и опрос обновлений getUpdates
// ============================================================================

function purgeExpiredCodes(now = Date.now()) {
    for (const [code, entry] of PENDING_CODES.entries()) {
        if (entry.expiresAt <= now)
            PENDING_CODES.delete(code);
    }
}

function generateRandomCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = crypto.randomBytes(8);
    let out = '';
    for (let i = 0; i < 8; i++)
        out += alphabet[bytes[i] % alphabet.length];
    return out;
}

/**
 * Создать одноразовый код привязки (для личного чата пользователя или группового чата подразделения).
 */
export async function createLinkCode({ uid, point = null, target = 'user', channel = '' } = {}) {
    purgeExpiredCodes();
    const resolved = target === 'group'
        ? await resolveBotForPoint(point)
        : await resolveBotForUser(uid, point);
    const bot = resolved?.bot || null;
    const code = generateRandomCode();
    const expiresAt = Date.now() + LINK_CODE_TTL_MS;
    const kind = channel || bot?.kind || 'telegram';

    const entry = {
        code,
        target: target === 'group' ? 'group' : 'user',
        uid: String(uid || ''),
        pointPath: resolved?.pointPath || (typeof point === 'string' ? point : point?.path) || '/',
        pointLabel: resolved?.pointLabel || '',
        channel: kind,
        botId: bot?.id || '',
        expiresAt,
    };
    PENDING_CODES.set(code, entry);

    let deepLink = '';
    if (bot?.username) {
        deepLink = bot.kind === 'max'
            ? `https://max.ru/${bot.username}?start=${code}`
            : `https://t.me/${bot.username}?start=${code}`;
    }

    return {
        code,
        target: entry.target,
        channel: kind,
        command: `/start ${code}`,
        deepLink,
        expiresAt: new Date(expiresAt).toISOString(),
        ttlSec: Math.round(LINK_CODE_TTL_MS / 1000),
        bot: sanitizeBotForUi(bot, {
            inherited: resolved?.inherited,
            sourcePath: resolved?.sourcePath,
            sourceLabel: resolved?.sourceLabel,
        }),
    };
}

/**
 * Обработать входящие события от бота (сопоставление одноразовых кодов `/start <CODE>`).
 */
export async function processBotEvents(bot, events = [], { sendReply = true } = {}) {
    purgeExpiredCodes();
    const matched = [];
    const adapter = getAdapter(bot.kind);

    for (const ev of events) {
        if (ev.chatType === 'group' && ev.chatId) {
            const key = `${bot.kind}:${bot.id || 'default'}`;
            if (!DISCOVERED_GROUPS.has(key))
                DISCOVERED_GROUPS.set(key, new Map());
            DISCOVERED_GROUPS.get(key).set(ev.chatId, {
                chatId: ev.chatId,
                title: ev.chatTitle || ev.chatId,
                channel: bot.kind,
                seenAt: Date.now(),
            });
        }

        const code = String(ev.code || '').toUpperCase();
        if (!code || !PENDING_CODES.has(code))
            continue;

        const pending = PENDING_CODES.get(code);
        if (pending.expiresAt <= Date.now()) {
            PENDING_CODES.delete(code);
            continue;
        }

        PENDING_CODES.delete(code);

        if (pending.target === 'group' || ev.chatType === 'group') {
            await savePointConfig(pending.pointPath, {
                groupChatId: ev.chatId,
                groupTitle: ev.chatTitle || ev.chatId,
                groupKind: bot.kind,
            });
            matched.push({
                type: 'group',
                code,
                pointPath: pending.pointPath,
                chatId: ev.chatId,
                chatTitle: ev.chatTitle,
                channel: bot.kind,
            });
            if (sendReply && bot.token) {
                await adapter.sendMessage(bot.token, {
                    chatId: ev.chatId,
                    text: `WORK: групповой чат «${ev.chatTitle || ev.chatId}» привязан к подразделению «${pending.pointLabel || pending.pointPath}».`,
                    apiUrl: bot.apiUrl,
                }).catch(() => {});
            }
        }
        else if (pending.uid) {
            const record = await bindUserChat(pending.uid, {
                channel: bot.kind,
                chatId: ev.chatId,
                userId: ev.userId || ev.chatId,
                username: ev.username,
                firstName: ev.firstName,
                botId: bot.id,
                pointPath: pending.pointPath,
            });
            const userPoints = await findUserPoints(pending.uid).catch(() => []);
            const pointsNote = userPoints.length
                ? `\nВаши подразделения: ${userPoints.map(p => p.label).join(', ')}.`
                : '';
            matched.push({
                type: 'user',
                code,
                uid: pending.uid,
                chatId: ev.chatId,
                username: ev.username,
                channel: bot.kind,
                record,
            });
            if (sendReply && bot.token) {
                await adapter.sendMessage(bot.token, {
                    chatId: ev.chatId,
                    userId: ev.userId,
                    text: `WORK: ваш чат привязан (пользователь ${pending.uid}, бот «${bot.label || bot.kind}»).${pointsNote}`,
                    apiUrl: bot.apiUrl,
                }).catch(() => {});
            }
        }
    }

    return matched;
}

/** Опросить обновления одного бота через getUpdates и обработать коды привязки. */
export async function pollBotUpdates(bot) {
    if (!bot?.token || bot.enabled === false)
        return [];
    const adapter = getAdapter(bot.kind);
    const offsetKey = `${bot.kind}:${bot.token}`;
    const offset = UPDATE_OFFSETS.get(offsetKey) || 0;
    const { events, nextOffset } = await adapter.getUpdates(bot.token, {
        offset,
        timeout: 0,
        limit: 50,
        apiUrl: bot.apiUrl,
    });
    if (nextOffset > offset)
        UPDATE_OFFSETS.set(offsetKey, nextOffset);
    if (!events.length)
        return [];
    return processBotEvents(bot, events);
}

/** Собрать все уникальные активные боты на сервере и в организациях. */
export async function collectActiveBots() {
    const seenTokens = new Set();
    const bots = [];
    const addFromConfig = (cfg) => {
        const list = [...(cfg.bot ? [cfg.bot] : []), ...(cfg.bots || [])];
        for (const b of list) {
            if (!b?.token || b.enabled === false)
                continue;
            const key = `${b.kind}:${b.token}`;
            if (seenTokens.has(key))
                continue;
            seenTokens.add(key);
            bots.push(b);
        }
    };

    addFromConfig(await readPointConfig('/'));

    const root = process.cwd();
    const orgsRoot = path.join(root, 'ORGANIZATIONS');
    if (fs.existsSync(orgsRoot)) {
        const walk = async (dir, relParts) => {
            let entries;
            try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); }
            catch { return; }
            if (entries.some(e => e.isDirectory() && (e.name === '$base' || e.name === '$structure')))
                addFromConfig(await readPointConfig('/' + relParts.join('/')));
            for (const e of entries) {
                if (!e.isDirectory() || e.name.startsWith('$') || e.name.startsWith('#') || e.name.startsWith('.'))
                    continue;
                if (e.name === 'MODULES' || e.name === 'CATALOGS' || e.name === 'OPERATIONS' || e.name === 'REGISTER')
                    continue;
                await walk(path.join(dir, e.name), [...relParts, e.name]);
            }
        };
        await walk(orgsRoot, ['ORGANIZATIONS']);
    }
    return bots;
}

export async function pollAllBots() {
    const bots = await collectActiveBots();
    const results = [];
    for (const bot of bots) {
        try {
            const m = await pollBotUpdates(bot);
            results.push(...m);
        }
        catch (e) {
            console.warn('[notify poll]', bot.label || bot.id, e.message);
        }
    }
    return results;
}

// ============================================================================
// Доставка уведомлений (персональная, общая по подразделению, расписания и задачи)
// ============================================================================

export function formatMessengerText(message) {
    if (typeof message === 'string')
        return message.trim();
    if (!message || typeof message !== 'object')
        return String(message || '').trim();
    const title = String(message.title || '').trim();
    const body = String(message.body || message.text || '').trim();
    const url = String(message.data?.url || message.url || '').trim();
    const lines = [];
    if (title)
        lines.push(title);
    if (body && body !== title)
        lines.push(body);
    if (url && !body.includes(url))
        lines.push(url);
    return lines.join('\n\n').trim();
}

async function sendWebPushFallback(uids, message) {
    const list = (Array.isArray(uids) ? uids : [uids]).filter(Boolean);
    if (!list.length || process.env.WORK_TEST)
        return false;
    try {
        const { sendPushNotification, removePushSubscription } = await import('../../host/push.js');
        const payload = typeof message === 'string'
            ? { title: 'WORK', body: message }
            : message;
        await sendPushNotification({ receivers: list, message: payload }, removePushSubscription);
        return true;
    }
    catch (e) {
        console.warn('[notify web-push fallback]', e.message);
        return false;
    }
}

/**
 * Персональная доставка пользователю через бот точки (с наследованием вверх).
 * При отсутствии привязанного чата или бота — fallback на браузерный web-push.
 */
export async function notifyPersonal(uid, message, { point = null, fallbackPush = true } = {}) {
    if (!uid)
        throw new Error('notifyPersonal: не указан uid получателя');
    const resolved = await resolveBotForUser(uid, point);
    const bot = resolved?.bot || null;
    const bindings = await readUserBindings(uid);

    if (bindings.enabled === false) {
        return { delivered: false, skipped: true, reason: 'уведомления отключены пользователем' };
    }

    const chatRec = (bot?.id && bindings.byBot?.[bot.id])
        || (bot?.kind && bindings.chats?.[bot.kind])
        || null;

    if (bot?.token && chatRec?.chatId) {
        try {
            const adapter = getAdapter(bot.kind);
            const res = await adapter.sendMessage(bot.token, {
                chatId: chatRec.chatId,
                userId: chatRec.userId,
                text: formatMessengerText(message),
                apiUrl: bot.apiUrl,
            });
            return {
                delivered: true,
                channel: bot.kind,
                botId: bot.id,
                botLabel: bot.label,
                chatId: chatRec.chatId,
                inherited: resolved.inherited,
                sourcePath: resolved.sourcePath,
                messageId: res.messageId,
            };
        }
        catch (e) {
            if (fallbackPush)
                await sendWebPushFallback([uid], message);
            return {
                delivered: false,
                fallback: fallbackPush ? 'web-push' : null,
                error: e.message,
                sourcePath: resolved?.sourcePath || '',
            };
        }
    }

    if (fallbackPush)
        await sendWebPushFallback([uid], message);

    return {
        delivered: false,
        fallback: fallbackPush ? 'web-push' : null,
        reason: !bot?.token ? 'бот не настроен в точке и вышестоящих узлах' : 'пользователь не привязал личный чат мессенджера',
        sourcePath: resolved?.sourcePath || '',
    };
}

/**
 * Общая доставка сообщения по подразделению ($structure / $base):
 *  - в привязанный групповой чат подразделения (`groupChatId`), если он настроен;
 *  - и/или веером всем формально привязанным участникам подразделения (`#security`: BOSS, ADMIN, USER, ROLES).
 */
export async function notifyDepartment(point, message, { mode = 'auto', roles = null, fallbackPush = true } = {}) {
    const resolved = await resolveBotForPoint(point);
    const bot = resolved?.bot || null;
    const memberUids = await getPointMemberUids(point, { roles });
    const text = formatMessengerText(message);
    const headerPrefix = resolved?.pointLabel && !text.startsWith(`[${resolved.pointLabel}]`)
        ? `[${resolved.pointLabel}] ${text}`
        : text;

    let groupDelivered = false;
    let groupError = '';

    if (bot?.token && resolved?.groupChatId && mode !== 'members') {
        try {
            const adapter = getAdapter(bot.kind);
            await adapter.sendMessage(bot.token, {
                chatId: resolved.groupChatId,
                text: headerPrefix,
                apiUrl: bot.apiUrl,
            });
            groupDelivered = true;
        }
        catch (e) {
            groupError = e.message;
        }
    }

    const membersDelivered = [];
    const fallbackUids = [];

    const shouldFanOut = mode === 'members'
        || mode === 'all'
        || (!groupDelivered && resolved?.broadcastToMembers !== false);

    if (shouldFanOut && memberUids.length) {
        for (const uid of memberUids) {
            const r = await notifyPersonal(uid, headerPrefix, { point, fallbackPush: false });
            if (r.delivered)
                membersDelivered.push({ uid, channel: r.channel, chatId: r.chatId });
            else
                fallbackUids.push(uid);
        }
        if (fallbackPush && fallbackUids.length)
            await sendWebPushFallback(fallbackUids, message);
    }

    return {
        delivered: groupDelivered || membersDelivered.length > 0,
        groupDelivered,
        groupChatId: resolved?.groupChatId || '',
        groupError: groupError || undefined,
        membersDelivered,
        fallbackUids,
        memberCount: memberUids.length,
        botId: bot?.id || '',
        channel: bot?.kind || '',
        inherited: resolved?.inherited || false,
        sourcePath: resolved?.sourcePath || '',
        pointPath: resolved?.pointPath || '',
    };
}

/**
 * Доставить результат планового запуска расписания (`scheduler.js`).
 */
export async function notifyScheduledRun({ schedule, file, answer = '' } = {}) {
    if (!schedule)
        return null;
    const point = file?.$owner || file?.path || schedule.task;
    const resolved = await resolveBotForPoint(point);
    if (resolved && resolved.notifySchedule === false)
        return { delivered: false, skipped: true };

    const title = `⏰ Напоминание: ${schedule.label || 'По расписанию'}`;
    const bodyText = String(answer || schedule.prompt || '').trim().slice(0, 1500);
    const taskUrl = file?.path || schedule.task || '';
    const message = {
        title,
        body: bodyText,
        data: { url: taskUrl, kind: 'schedule', scheduleId: schedule.id },
    };

    const rule = typeof schedule.rule === 'string' ? JSON.parse(schedule.rule) : (schedule.rule || {});
    if (rule.scope === 'department') {
        return notifyDepartment(point, message, { fallbackPush: true });
    }
    const targetUid = schedule.uid || String(taskUrl).match(/\.([A-Za-z0-9_-]+)\.task$/)?.[1] || '';
    return notifyPersonal(targetUid, message, { point, fallbackPush: true });
}

/**
 * Доставить событие задачи (`waiting`, `error`, `review`, `done`) в мессенджер владельцу.
 * Вызывается из `session.js` параллельно со штатным web-push.
 */
export async function notifyTaskEvent({ file, uid, kind, text, detail = {} } = {}) {
    if (!uid)
        return null;
    const point = file?.$owner || file?.path || null;
    const resolved = await resolveBotForUser(uid, point);
    if (!resolved?.bot || resolved.notifyTasks === false)
        return { delivered: false, skipped: true };

    const taskName = file?.DATA?.name || file?.id || 'Задача';
    const prefix = kind === 'waiting' ? `❓ Ждёт подтверждения (${taskName})`
        : kind === 'error' ? `⚠️ Ошибка в задаче (${taskName})`
        : kind === 'review' ? `🔍 Требует проверки (${taskName})`
        : `✅ Задача выполнена (${taskName})`;

    const bodyText = String(text || detail?.reason || '').trim().slice(0, 1200) || taskName;
    return notifyPersonal(uid, {
        title: prefix,
        body: bodyText,
        data: { url: file?.path || '', kind },
    }, { point, fallbackPush: false });
}

/**
 * Полный статус мессенджеров для UI настройки точки (`form/staff` и диалог настроек `form/chat`).
 */
export async function getPointMessengerStatus(point, { uid = '' } = {}) {
    // Перед отдачей статуса проверяем свежие `/start <CODE>` у активного бота точки
    const resolvedBefore = await resolveBotForPoint(point);
    if (resolvedBefore?.bot?.token && !process.env.WORK_TEST) {
        await pollBotUpdates(resolvedBefore.bot).catch(() => {});
    }

    const ownCfg = await readPointConfig(point);
    const resolved = await resolveBotForPoint(point);
    const memberUids = await getPointMemberUids(point);

    const membersStatus = [];
    for (const mUid of memberUids) {
        const b = await readUserBindings(mUid);
        const tg = b.chats?.telegram;
        const mx = b.chats?.max;
        membersStatus.push({
            uid: mUid,
            telegram: tg ? { chatId: tg.chatId, username: tg.username, firstName: tg.firstName, linkedAt: tg.linkedAt } : null,
            max: mx ? { chatId: mx.chatId, username: mx.username, firstName: mx.firstName, linkedAt: mx.linkedAt } : null,
        });
    }

    let currentUserBindings = null;
    if (uid) {
        const ub = await readUserBindings(uid);
        currentUserBindings = {
            uid,
            enabled: ub.enabled !== false,
            telegram: ub.chats?.telegram || null,
            max: ub.chats?.max || null,
        };
    }

    const botKey = resolved?.bot ? `${resolved.bot.kind}:${resolved.bot.id || 'default'}` : '';
    const discoveredGroups = botKey && DISCOVERED_GROUPS.has(botKey)
        ? [...DISCOVERED_GROUPS.get(botKey).values()]
        : [];

    return {
        pointPath: resolved?.pointPath || '/',
        pointLabel: resolved?.pointLabel || 'WORK',
        ownBot: sanitizeBotForUi(ownCfg.bot),
        ownBotId: ownCfg.botId || '',
        ownBots: (ownCfg.bots || []).map(b => sanitizeBotForUi(b)),
        effectiveBot: sanitizeBotForUi(resolved?.bot, {
            inherited: resolved?.inherited || false,
            sourcePath: resolved?.sourcePath || '',
            sourceLabel: resolved?.sourceLabel || '',
        }),
        availableBots: resolved?.availableBots || [],
        groupChatId: ownCfg.groupChatId || '',
        groupTitle: ownCfg.groupTitle || '',
        broadcastToMembers: ownCfg.broadcastToMembers !== false,
        notifySchedule: ownCfg.notifySchedule !== false,
        notifyTasks: ownCfg.notifyTasks !== false,
        discoveredGroups,
        members: membersStatus,
        currentUser: currentUserBindings,
    };
}

// ============================================================================
// Фоновый воркер опроса входящих кодов привязки
// ============================================================================

let pollTimer = null;
let pollBusy = false;

export function startNotifier() {
    if (pollTimer)
        return;
    pollTimer = setInterval(async () => {
        if (pollBusy)
            return;
        pollBusy = true;
        try {
            await pollAllBots();
        }
        catch (e) {
            console.warn('[notify worker]', e.message);
        }
        finally {
            pollBusy = false;
        }
    }, POLL_INTERVAL_MS);
    pollTimer.unref?.();
}

export function stopNotifier() {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
}

/** Сбросить внутреннее состояние в тестах. */
export function _resetNotifyStateForTests() {
    PENDING_CODES.clear();
    UPDATE_OFFSETS.clear();
    DISCOVERED_GROUPS.clear();
}

function unpackParams(p = {}) {
    if (typeof p.post === 'object' && p.post)
        return { ...p, ...p.post };
    if (typeof p.post === 'string' && p.post.trim().startsWith('{')) {
        try { return { ...p, ...JSON.parse(p.post) }; }
        catch { /* ignore */ }
    }
    return p;
}

/**
 * Методы `messenger_*`, подключаемые к `$class.prototype` и в шлюз `gateway.js`.
 */
export const NOTIFY_METHODS = Object.freeze({
    messenger_status: {
        level: 'read',
        fn: async function (p = {}) {
            const body = unpackParams(p);
            const uid = this.constructor.resolveUid?.(p) || body.uid || '';
            return getPointMessengerStatus(this, { uid });
        },
    },
    messenger_save_config: {
        level: 'admin',
        fn: async function (p = {}) {
            await this.assertAccess(p, this.constructor.ACCESS_LEVEL.ADMIN);
            const body = unpackParams(p);
            if (body.bot && body.bot.token && !isMaskedOrEmpty(body.bot.token) && body.verify !== false) {
                try {
                    const adapter = getAdapter(body.bot.kind || 'telegram');
                    const me = await adapter.getMe(body.bot.token, { apiUrl: body.bot.apiUrl });
                    if (me?.username && !body.bot.username)
                        body.bot.username = me.username;
                    if (me?.name && !body.bot.label)
                        body.bot.label = me.name;
                }
                catch (e) {
                    if (body.verify === true)
                        throw e;
                }
            }
            await savePointConfig(this, body);
            const uid = this.constructor.resolveUid?.(p) || '';
            return getPointMessengerStatus(this, { uid });
        },
    },
    messenger_link_code: {
        level: 'read',
        fn: async function (p = {}) {
            const body = unpackParams(p);
            const target = body.target === 'group' ? 'group' : 'user';
            if (target === 'group')
                await this.assertAccess(p, this.constructor.ACCESS_LEVEL.ADMIN);
            const uid = this.constructor.resolveUid?.(p) || body.uid || '';
            if (target === 'user' && !uid)
                throw new Error('Для привязки личного чата необходима авторизация пользователя');
            return createLinkCode({
                uid,
                point: this,
                target,
                channel: body.channel || '',
            });
        },
    },
    messenger_poll: {
        level: 'read',
        fn: async function (p = {}) {
            const body = unpackParams(p);
            const resolved = await resolveBotForPoint(this);
            const matched = resolved?.bot?.token ? await pollBotUpdates(resolved.bot) : [];
            const uid = this.constructor.resolveUid?.(p) || body.uid || '';
            const status = await getPointMessengerStatus(this, { uid });
            return { ...status, matched };
        },
    },
    messenger_unbind: {
        level: 'write',
        fn: async function (p = {}) {
            const body = unpackParams(p);
            const callerUid = this.constructor.resolveUid?.(p) || '';
            if (body.target === 'group') {
                await this.assertAccess(p, this.constructor.ACCESS_LEVEL.ADMIN);
                await savePointConfig(this, { groupChatId: '', groupTitle: '', groupKind: '' });
            }
            else {
                const targetUid = body.uid && body.uid !== callerUid
                    ? (await this.assertAccess(p, this.constructor.ACCESS_LEVEL.ADMIN), body.uid)
                    : (callerUid || body.uid);
                if (!targetUid)
                    throw new Error('Не указан пользователь для отвязки чата');
                await unbindUserChat(targetUid, {
                    channel: body.channel || '',
                    botId: body.botId || '',
                });
            }
            return getPointMessengerStatus(this, { uid: callerUid });
        },
    },
    messenger_test: {
        level: 'write',
        fn: async function (p = {}) {
            const body = unpackParams(p);
            const scope = body.scope === 'department' ? 'department' : 'personal';
            const label = this.label || this.DATA?.label || this.id || 'WORK';
            const text = String(body.text || `Проверка связи WORK от точки «${label}»`).trim();
            if (scope === 'department') {
                await this.assertAccess(p, this.constructor.ACCESS_LEVEL.ADMIN);
                return notifyDepartment(this, {
                    title: `🔔 Проверка подразделения «${label}»`,
                    body: text,
                }, { mode: body.mode || 'auto', fallbackPush: false });
            }
            const uid = body.uid || this.constructor.resolveUid?.(p) || '';
            if (!uid)
                throw new Error('Не указан получатель для проверки персональной доставки');
            return notifyPersonal(uid, {
                title: `🔔 Проверка связи WORK («${label}»)`,
                body: text,
            }, { point: this, fallbackPush: false });
        },
    },
});

