/**
 * Шифрование секретов на диске (AES-256-GCM): токены подключений пользователей и т.п.
 *
 * Формат: { v: 2, alg: 'aes-256-gcm', kid, iv, tag, data } (base64). AAD привязывает шифртекст к владельцу
 * (`uid/имя`): файл нельзя подсунуть другому пользователю или под другим именем.
 *
 * Мастер-ключ (по приоритету):
 *   1. env WORK_SECRET_KEY — 32 байта: 64 hex-символа или base64;
 *   2. производный от закрытого ключа сервера `#system/node-key.json` (создаётся при первом обращении).
 * Ключ шифрования = HKDF-SHA256(мастер-ключ, соль, info). Расшифровка перебирает оба источника по `kid`,
 * поэтому WORK_SECRET_KEY можно добавить позже: старые записи читаются и перешифровываются (rekey).
 *
 * Защита рассчитана на утечку копий данных (бэкапы/архивы `USERS/` без `#system/`, случайный коммит);
 * при доступе к `#system/` и данным одновременно без WORK_SECRET_KEY она не помогает.
 * Потеря node-key.json (без WORK_SECRET_KEY) = записи не расшифровать, подключения нужно создать заново.
 */
import crypto from 'node:crypto';

const ALG = 'aes-256-gcm';
const SALT = Buffer.from('work-secret-box/v1');

/** @returns {Buffer|null} 32 байта из env WORK_SECRET_KEY (hex | base64) */
function envKey() {
    const raw = String(process.env.WORK_SECRET_KEY || '').trim();
    if (!raw)
        return null;
    const buf = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
    if (buf.length !== 32)
        throw new Error('WORK_SECRET_KEY: нужно 32 байта — 64 hex-символа или base64 (например: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))")');
    return buf;
}

async function nodeKey() {
    const { serverKeys } = await import('../modules/nodes/identity.js');
    return serverKeys().private.export({ type: 'pkcs8', format: 'der' });
}

/** Кандидаты ключей для назначения `info`: сначала основной (env, если задан), затем резервный. */
async function candidates(info) {
    const masters = [];
    const env = envKey();
    if (env)
        masters.push(env);
    masters.push(await nodeKey());
    return masters.map(ikm => {
        const key = Buffer.from(crypto.hkdfSync('sha256', ikm, SALT, String(info), 32));
        return { key, kid: crypto.createHash('sha256').update(key).digest('hex').slice(0, 8) };
    });
}

export function isSealed(obj) {
    return !!obj && typeof obj === 'object' && obj.v === 2 && obj.alg === ALG
        && typeof obj.iv === 'string' && typeof obj.tag === 'string' && typeof obj.data === 'string';
}

/**
 * Зашифровать значение.
 * @param {*} value JSON-сериализуемое
 * @param {{info: string, aad: string}} ctx info — назначение (домен ключа), aad — владелец записи
 */
export async function seal(value, { info, aad }) {
    const [{ key, kid }] = await candidates(info);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALG, key, iv, { authTagLength: 16 });
    cipher.setAAD(Buffer.from(String(aad)));
    const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf-8'), cipher.final()]);
    return { v: 2, alg: ALG, kid, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}

/**
 * Расшифровать запись.
 * @returns {Promise<{value: *, rekey: boolean}>} rekey — записано не основным ключом: стоит перешифровать
 * @throws {Error} code SECRET_KEY_MISMATCH (нет подходящего ключа) | SECRET_CORRUPT (повреждена или чужая)
 */
export async function open(sealed, { info, aad }) {
    if (!isSealed(sealed))
        throw Object.assign(new Error('неизвестный формат записи'), { code: 'SECRET_CORRUPT' });
    const list = await candidates(info);
    const index = list.findIndex(c => c.kid === sealed.kid);
    if (index < 0)
        throw Object.assign(new Error('ключ шифрования изменился (запись зашифрована ключом ' + sealed.kid + ')'), { code: 'SECRET_KEY_MISMATCH' });
    try {
        const decipher = crypto.createDecipheriv(ALG, list[index].key, Buffer.from(sealed.iv, 'base64'), { authTagLength: 16 });
        decipher.setAAD(Buffer.from(String(aad)));
        decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
        const text = Buffer.concat([decipher.update(Buffer.from(sealed.data, 'base64')), decipher.final()]).toString('utf-8');
        return { value: JSON.parse(text), rekey: index > 0 };
    }
    catch {
        throw Object.assign(new Error('запись повреждена или принадлежит другому владельцу'), { code: 'SECRET_CORRUPT' });
    }
}
