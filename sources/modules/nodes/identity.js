/**
 * Идентичность сервера в сети WORK: пара ключей Ed25519 (закрытый — `#system/node-key.json`,
 * вне дерева WORK), публичная карточка узла `/.well-known/work-node`.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { serverId } from '../../host/server-id.js';
import { PUBLIC_ORIGIN, LOCAL_ORIGIN } from '../../host/config.js';

export const PROTOCOL = 'work-node/1';
const KEY_PATH = './#system/node-key.json';

let keys = null;

/** Ключи сервера (создаются при первом обращении). */
export function serverKeys() {
    if (keys)
        return keys;
    let data = null;
    try {
        data = JSON.parse(fs.readFileSync(KEY_PATH, 'utf-8'));
    }
    catch { /* нет ключа — создаём */ }
    if (!data?.privateKey || !data?.publicKey) {
        const pair = crypto.generateKeyPairSync('ed25519');
        data = {
            publicKey: pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
            privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
            created: Date.now(),
        };
        fs.mkdirSync('./#system', { recursive: true });
        const tmp = KEY_PATH + '.' + process.pid + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
        fs.renameSync(tmp, KEY_PATH);
    }
    keys = {
        publicKey: data.publicKey,
        private: crypto.createPrivateKey({ key: Buffer.from(data.privateKey, 'base64'), format: 'der', type: 'pkcs8' }),
    };
    return keys;
}

/** Отпечаток публичного ключа: SHA-256, первые 16 байт hex группами по 4 (для сверки людьми). */
export function fingerprint(publicKeyB64) {
    const hex = crypto.createHash('sha256').update(Buffer.from(String(publicKeyB64), 'base64')).digest('hex').slice(0, 32).toUpperCase();
    return hex.match(/.{4}/g).join('-');
}

export function sign(data) {
    return crypto.sign(null, Buffer.from(data), serverKeys().private).toString('base64');
}

export function verify(data, signatureB64, publicKeyB64) {
    try {
        const key = crypto.createPublicKey({ key: Buffer.from(publicKeyB64, 'base64'), format: 'der', type: 'spki' });
        return crypto.verify(null, Buffer.from(data), key, Buffer.from(String(signatureB64), 'base64'));
    }
    catch {
        return false;
    }
}

export function selfOrigin() {
    return (PUBLIC_ORIGIN || LOCAL_ORIGIN).replace(/\/+$/, '');
}

let rolesCache = null;

/** Каталог ролей, объявленных на сервере (базовые + прикладные из class.js известных классов). */
async function roleCatalog() {
    if (rolesCache && Date.now() - rolesCache.at < 10 * 60_000)
        return rolesCache.roles;
    const out = new Map();
    const add = (declared) => {
        for (const [id, r] of Object.entries(declared || {}))
            if (!out.has(id))
                out.set(id, { id, label: r.label, principals: r.principals });
    };
    try {
        add(await globalThis.WORK.declared_roles);
        const store = await import('../rag/store.js');
        if (await store.open()) {
            const paths = store.classesBelow('/', 2000);
            for (const p of paths) {
                try {
                    const cls = await globalThis.WORK.get_item(p);
                    if (cls?.declared_roles)
                        add(await cls.declared_roles);
                }
                catch { /* класс недоступен */ }
            }
        }
    }
    catch { /* только базовые */ }
    // роли, которые нельзя выдать узлам, в каталог сети не публикуются
    const roles = [...out.values()].filter(r => !r.principals || r.principals.includes('node'))
        .map(({ id, label }) => ({ id, label }));
    rolesCache = { at: Date.now(), roles };
    return roles;
}

/** Публичная карточка узла. */
export async function wellKnown() {
    const WORK = globalThis.WORK;
    const { publicKey } = serverKeys();
    let peers = [];
    try {
        const { listNodes } = await import('./registry.js');
        peers = (await listNodes()).filter(n => n.announce && n.status === 'active')
            .map(n => ({ id: n.host_id, label: n.label, origin: n.origin, fingerprint: n.fingerprint }));
    }
    catch { /* реестр пуст */ }
    return {
        protocol: PROTOCOL,
        id: serverId,
        label: WORK?.DATA?.label || WORK?.label || 'WORK',
        origin: selfOrigin(),
        publicKey,
        fingerprint: fingerprint(publicKey),
        roles: await roleCatalog(),
        peers,
    };
}
