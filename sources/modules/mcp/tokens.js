/**
 * Токены доступа внешних ИИ-клиентов (OpenCode, Claude Code…) к WORK по MCP.
 *
 * Формат токена: `wmcp.<uid>.<секрет>` (секрет — 32 случайных байта, base64url). Выпускает вошедший пользователь
 * (метод mcp_token_create, кнопка в профиле); показывается один раз. Хранилище:
 *   USERS/<uid>/$user/#secret/mcp-tokens.json — запись зашифрована (host/secret-box.js, AAD = uid),
 *   внутри — только ХЕШ секрета (sha256) и метаданные: id, роль, подпись, даты. Сам секрет не хранится нигде.
 * Роль токена — «шляпа», в которой клиент действует (как роль задачи у агента): права проверяет ядро WORK.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as SB from '../../host/secret-box.js';

export const UID_RE = /^[0-9A-F]{16}$/;
export const ROLE_RE = /^[A-Z][A-Z0-9_]{0,31}$/;
export const MAX_TOKENS = 10;
const INFO = 'work-mcp-tokens';
/** lastUsed обновляем не чаще, чем раз в это время (не пишем файл на каждый запрос). */
const TOUCH_MS = 5 * 60_000;

const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const fileOf = uid => path.join(process.cwd(), 'USERS', uid, '$user', '#secret', 'mcp-tokens.json');
const locks = new Map();

/** Последовательное выполнение операций над файлом одного пользователя (без потери обновлений). */
function exclusive(uid, fn) {
    const prev = locks.get(uid) || Promise.resolve();
    const next = prev.catch(() => {}).then(fn);
    locks.set(uid, next);
    return next.finally(() => { if (locks.get(uid) === next) locks.delete(uid); });
}

async function load(uid) {
    let parsed;
    try {
        parsed = JSON.parse(await fs.promises.readFile(fileOf(uid), 'utf-8'));
    }
    catch {
        return { tokens: [] };
    }
    if (!SB.isSealed(parsed))
        return { tokens: Array.isArray(parsed?.tokens) ? parsed.tokens : [] };
    const { value } = await SB.open(parsed, { info: INFO, aad: uid });
    return { tokens: Array.isArray(value?.tokens) ? value.tokens : [] };
}

async function save(uid, data) {
    const file = fileOf(uid);
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    await fs.promises.writeFile(tmp, JSON.stringify(await SB.seal(data, { info: INFO, aad: uid }), null, 2), { encoding: 'utf-8', mode: 0o600 });
    await fs.promises.rename(tmp, file);
}

function checkUid(uid) {
    if (!UID_RE.test(String(uid || '')))
        throw new Error('токены MCP доступны после входа в систему');
    return String(uid);
}

/**
 * Выпустить токен. Возвращает токен ОДИН раз.
 * @returns {Promise<{ token: string, id: string, role: string|null, label: string }>}
 */
export async function issueToken(uid, { role, label } = {}) {
    uid = checkUid(uid);
    const r = role == null || role === '' ? null : String(role).toUpperCase();
    if (r && !ROLE_RE.test(r))
        throw new Error('роль: заглавные латинские буквы, цифры и _ (например USER)');
    const name = String(label || 'MCP-клиент').replace(/[\r\n]+/g, ' ').trim().slice(0, 60) || 'MCP-клиент';
    return exclusive(uid, async () => {
        const data = await load(uid);
        if (data.tokens.length >= MAX_TOKENS)
            throw new Error('не больше ' + MAX_TOKENS + ' токенов: отзовите ненужные');
        const secret = crypto.randomBytes(32).toString('base64url');
        const hash = sha(secret);
        const rec = { id: hash.slice(0, 10), hash, role: r, label: name, created: Date.now(), lastUsed: null };
        data.tokens.push(rec);
        await save(uid, data);
        return { token: 'wmcp.' + uid + '.' + secret, id: rec.id, role: r, label: name };
    });
}

/** Список токенов пользователя без секретов и хешей. */
export async function listTokens(uid) {
    uid = checkUid(uid);
    return (await load(uid)).tokens.map(({ id, role, label, created, lastUsed }) => ({ id, role, label, created, lastUsed }));
}

/** Отозвать токен по id (или все: id = 'all'). @returns {Promise<number>} сколько отозвано */
export async function revokeToken(uid, id) {
    uid = checkUid(uid);
    return exclusive(uid, async () => {
        const data = await load(uid);
        const keep = id === 'all' ? [] : data.tokens.filter(t => t.id !== String(id));
        const removed = data.tokens.length - keep.length;
        if (removed)
            await save(uid, { tokens: keep });
        return removed;
    });
}

/**
 * Проверить предъявленный токен. Не раскрывает причину отказа (нет пользователя / нет токена / повреждён файл).
 * @returns {Promise<{ uid: string, role: string|null, id: string, label: string }|null>}
 */
export async function verifyToken(raw) {
    const m = String(raw || '').trim().match(/^wmcp\.([0-9A-F]{16})\.([A-Za-z0-9_-]{43})$/);
    if (!m)
        return null;
    const [, uid, secret] = m;
    let data;
    try {
        data = await load(uid);
    }
    catch {
        return null;
    }
    const hash = Buffer.from(sha(secret), 'hex');
    const hit = data.tokens.find(t => /^[0-9a-f]{64}$/.test(t.hash || '') && crypto.timingSafeEqual(Buffer.from(t.hash, 'hex'), hash));
    if (!hit)
        return null;
    if (!hit.lastUsed || Date.now() - hit.lastUsed > TOUCH_MS)
        exclusive(uid, async () => {
            const fresh = await load(uid);
            const t = fresh.tokens.find(x => x.id === hit.id);
            if (t) {
                t.lastUsed = Date.now();
                await save(uid, fresh);
            }
        }).catch(() => { /* метка использования — необязательна */ });
    return { uid, role: hit.role || null, id: hit.id, label: hit.label };
}
