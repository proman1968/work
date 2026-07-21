import * as crypto from 'node:crypto';

function canonicalPayload(lic) {
    const { header, human, terms } = lic;
    return JSON.stringify({ header, human, terms });
}

/** Sign with provided key pair (from WORK.read_secret / save_secret). */
export function signLicense(payload, { privateKey }) {
    if (!privateKey)
        throw new Error('licenses: no privateKey');
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(canonicalPayload(payload));
    sign.end();
    return sign.sign(privateKey, 'base64');
}

export function verifyLicense(lic, { publicKey, trustAnchors = [] } = {}) {
    if (!lic?.signature || !lic?.header)
        return { ok: false, reason: 'invalid format' };
    if (!publicKey)
        return { ok: false, reason: 'no public key configured' };

    const verify = crypto.createVerify('RSA-SHA256');
    verify.update(canonicalPayload(lic));
    verify.end();
    if (verify.verify(publicKey, lic.signature, 'base64'))
        return { ok: true };

    for (const anchor of trustAnchors) {
        if (!anchor?.publicKey) continue;
        const v = crypto.createVerify('RSA-SHA256');
        v.update(canonicalPayload(lic));
        v.end();
        if (v.verify(anchor.publicKey, lic.signature, 'base64'))
            return { ok: true, anchor: anchor.id || anchor.name };
    }
    return { ok: false, reason: 'bad signature' };
}

export function generateKeyPair() {
    return crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
}

/**
 * Гарантирует наличие ключевой пары лицензий в #system/licenses.json.
 * Один источник для issue/getActive/renew: читает секрет, при отсутствии —
 * генерирует пару и сохраняет. Возвращает { privateKey, publicKey, trustAnchors }.
 */
export async function licenseKeys(WORK) {
    let cfg = await WORK.read_secret({ name: 'licenses', user: WORK });
    if (cfg?.privateKey && cfg?.publicKey)
        return cfg;
    const pair = generateKeyPair();
    cfg = {
        ...cfg,
        privateKey: pair.privateKey,
        publicKey: pair.publicKey,
        trustAnchors: cfg?.trustAnchors || [],
    };
    await WORK.save_secret({ name: 'licenses', post: cfg, user: WORK });
    console.warn('[licenses] Generated key pair in #system/licenses.json');
    return cfg;
}

export function buildLicense({ subject, planId, holder, terms = {}, days = 365 }, keys) {
    const now = Date.now();
    const id = crypto.randomBytes(8).toString('hex');
    const payload = {
        header: {
            version: 1,
            id,
            issuedAt: now,
            expiresAt: now + days * 86400000,
        },
        human: { subject, planId, holder },
        terms,
    };
    payload.signature = signLicense(payload, keys);
    return payload;
}

export function isExpired(lic) {
    const exp = lic?.header?.expiresAt;
    return exp != null && Date.now() > exp;
}
