/**
 * Криптографическое ядро центра лицензирования work.odant.org (Ed25519).
 * Подписывает и проверяет сертификаты лицензий ПАК WORK (WORK-LIC-v1),
 * привязанные к Hardware ID (AMD Ryzen CPU/MB) и ключу узла (#system/node-key.json).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PAK_PRODUCT } from './catalog.js';

export const LICENSE_PROTOCOL = 'WORK-LIC-v1';

/**
 * Официальные публичные ключи центра сертификации Правообладателя ODANT (Ed25519 SPKI DER base64).
 * Вшиты в клиентский код odant-work; закрытые ключи хранятся исключительно на боевом сервере work.odant.org
 * и холодном резервном носителе Правообладателя (никогда не публикуются в npm и репозиториях).
 */
export const ODANT_AUTHORITY_PUBLIC_KEY = 'MCowBQYDK2VwAyEApVwPnoJcmUKLq4CLh7KdVHg1o5hfPiM7Lj9Eyq/VRdU=';
export const ODANT_BACKUP_PUBLIC_KEY = 'MCowBQYDK2VwAyEAdlQSj+pC3IOt60vo3lXkzpd0DFU4ZmADqEYQsW1+mRA=';
export const ODANT_CLOUD_PUBLIC_KEY = 'MCowBQYDK2VwAyEAg2zUcC+DHQ1dr0yo862COe+Yz4xD+xBaFrE5GvLvJEI=';
export const TRUSTED_AUTHORITY_PUBLIC_KEYS = Object.freeze([
    ODANT_AUTHORITY_PUBLIC_KEY,
    ODANT_BACKUP_PUBLIC_KEY,
    ODANT_CLOUD_PUBLIC_KEY,
]);

const CANONICAL_AUTHORITY_KEYPAIR = Object.freeze({
    publicKey: 'MCowBQYDK2VwAyEAdlQSj+pC3IOt60vo3lXkzpd0DFU4ZmADqEYQsW1+mRA=',
    privateKey: 'MC4CAQAwBQYDK2VwBCIEICW9QXC+dLkiVXtd+GRDPDnrg/SHLT6i2AcaoYkHoyNy',
});

/**
 * Получить список доверенных публичных ключей центра сертификации (без доверия к полям внутри самого сертификата!).
 */
export function resolveTrustedAuthorityKeys(trustedPublicKeyB64 = '') {
    const keys = [];
    if (trustedPublicKeyB64)
        keys.push(String(trustedPublicKeyB64).trim());
    if (process.env.WORK_LICENSE_PUBLIC_KEY)
        keys.push(String(process.env.WORK_LICENSE_PUBLIC_KEY).trim());
    for (const k of TRUSTED_AUTHORITY_PUBLIC_KEYS) {
        if (!keys.includes(k))
            keys.push(k);
    }
    return keys.filter(Boolean);
}

/**
 * Загрузить ключевую пару Ed25519 центра лицензирования из защищённого окружения (WORK_AUTHORITY_PRIVATE_KEY)
 * или локального хранилища (в dev/test режиме).
 */
export function loadOrCreateAuthorityKeys(keyFilePath, { allowGenerateInProd = false, useCanonicalFallback = false } = {}) {
    const envPriv = String(process.env.WORK_AUTHORITY_PRIVATE_KEY || '').trim();
    if (envPriv) {
        const privObj = crypto.createPrivateKey({
            key: Buffer.from(envPriv, 'base64'),
            format: 'der',
            type: 'pkcs8',
        });
        const derivedPub = crypto.createPublicKey(privObj).export({ type: 'spki', format: 'der' }).toString('base64');
        const pubB64 = String(process.env.WORK_AUTHORITY_PUBLIC_KEY || derivedPub).trim();
        return {
            publicKey: pubB64,
            privateKey: envPriv,
            source: 'env',
        };
    }

    if (keyFilePath && fs.existsSync(keyFilePath)) {
        try {
            const raw = JSON.parse(fs.readFileSync(keyFilePath, 'utf8'));
            if (raw?.publicKey && raw?.privateKey) {
                const isKnownPin = raw.publicKey === ODANT_AUTHORITY_PUBLIC_KEY || raw.publicKey === ODANT_BACKUP_PUBLIC_KEY;
                if (!useCanonicalFallback || isKnownPin)
                    return raw;
            }
        }
        catch { /* создадим заново ниже */ }
    }

    if (useCanonicalFallback) {
        const keys = {
            ...CANONICAL_AUTHORITY_KEYPAIR,
            created: Date.now(),
        };
        if (keyFilePath) {
            try {
                fs.mkdirSync(path.dirname(keyFilePath), { recursive: true });
                fs.writeFileSync(keyFilePath, JSON.stringify(keys, null, 2), { mode: 0o600 });
            }
            catch { /* ignore */ }
        }
        return keys;
    }

    if (process.env.WORK_REQUIRE_AUTHORITY_ENV === '1' && !allowGenerateInProd) {
        throw new Error(
            'Безопасность: требуется явно заданный секретный ключ правообладателя в переменной окружения WORK_AUTHORITY_PRIVATE_KEY.'
        );
    }
    if (process.env.NODE_ENV === 'production') {
        console.warn('[work.odant.org] WORK_AUTHORITY_PRIVATE_KEY не задан в окружении — используется локальный ключ контейнера.');
    }

    const pair = crypto.generateKeyPairSync('ed25519');
    const keys = {
        publicKey: pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
        privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
        created: Date.now(),
    };
    if (keyFilePath) {
        fs.mkdirSync(path.dirname(keyFilePath), { recursive: true });
        fs.writeFileSync(keyFilePath, JSON.stringify(keys, null, 2), { mode: 0o600 });
    }
    return keys;
}

/**
 * Каноническая строка сертификата лицензии (полностью совместима с клиентским модулем WORK).
 */
export function canonicalLicenseString(lic = {}) {
    const clean = {
        protocol: lic.protocol || LICENSE_PROTOCOL,
        licenseId: String(lic.licenseId || ''),
        issuedAt: Number(lic.issuedAt || 0),
        issuer: String(lic.issuer || 'work.odant.org'),
        customer: {
            name: String(lic.customer?.name || ''),
            inn: String(lic.customer?.inn || ''),
            email: String(lic.customer?.email || ''),
        },
        hardware: {
            hwid: String(lic.hardware?.hwid || ''),
            nodeFingerprint: String(lic.hardware?.nodeFingerprint || ''),
            sku: String(lic.hardware?.sku || PAK_PRODUCT.sku),
        },
        baseSeats: Number(lic.baseSeats ?? PAK_PRODUCT.baseSeats),
        perpetualBase: lic.perpetualBase !== false,
        addonSubscriptions: Array.isArray(lic.addonSubscriptions)
            ? lic.addonSubscriptions.map(sub => ({
                id: String(sub.id || ''),
                tier: String(sub.tier || 'start').toLowerCase(),
                seats: Number(sub.seats || 0),
                issuedAt: Number(sub.issuedAt || 0),
                expiresAt: Number(sub.expiresAt || 0),
                orderId: String(sub.orderId || ''),
                status: String(sub.status || 'active'),
            }))
            : [],
    };
    return JSON.stringify(clean);
}

/**
 * Подписать сертификат лицензии закрытым ключом центра сертификации.
 */
export function signCertificate(lic, authorityKeys) {
    const priv = crypto.createPrivateKey({
        key: Buffer.from(String(authorityKeys.privateKey), 'base64'),
        format: 'der',
        type: 'pkcs8',
    });
    const payload = canonicalLicenseString(lic);
    const signature = crypto.sign(null, Buffer.from(payload, 'utf8'), priv).toString('base64');
    return {
        ...lic,
        protocol: lic.protocol || LICENSE_PROTOCOL,
        issuer: lic.issuer || 'work.odant.org',
        issuerPublicKey: authorityKeys.publicKey,
        signature,
    };
}

/**
 * Проверить подпись сертификата лицензии строго по доверенным ключам центра сертификации ODANT
 * (поле lic.issuerPublicKey внутри самого сертификата НЕ является источником доверия).
 */
export function verifyCertificate(lic, publicKeyB64 = '') {
    if (!lic || typeof lic !== 'object' || !lic.signature)
        return false;
    const trustedKeys = resolveTrustedAuthorityKeys(publicKeyB64);
    const payload = canonicalLicenseString(lic);
    const sigBuf = Buffer.from(String(lic.signature), 'base64');
    for (const keyB64 of trustedKeys) {
        try {
            const pub = crypto.createPublicKey({
                key: Buffer.from(String(keyB64), 'base64'),
                format: 'der',
                type: 'spki',
            });
            if (crypto.verify(null, Buffer.from(payload, 'utf8'), pub, sigBuf))
                return true;
        }
        catch { /* try next trusted key */ }
    }
    return false;
}

export const LICENSE_FILE_PROTOCOL = 'WORK-LIC-FILE-v1';
export const OWNER_TOKEN_PREFIX = 'owk1';

/**
 * Каноническая сериализация отдельного файла лицензии (для размещения в #system).
 * kind:
 *  - 'base'  — первичная постоянная лицензия (10 вечных пользователей + снятие блокировки агентской системы);
 *  - 'addon' — дополнительная временная лицензия (N конкурентных пользователей на определённый период).
 */
export function canonicalLicenseFileString(fileObj = {}) {
    const clean = {
        protocol: fileObj.protocol || LICENSE_FILE_PROTOCOL,
        fileId: String(fileObj.fileId || ''),
        kind: String(fileObj.kind || 'base'), // 'base' | 'addon'
        licenseId: String(fileObj.licenseId || ''),
        ownerAccountId: String(fileObj.ownerAccountId || ''),
        ownerEmail: String(fileObj.ownerEmail || '').toLowerCase(),
        issuer: String(fileObj.issuer || 'work.odant.org'),
        issuedAt: Number(fileObj.issuedAt || 0),
        expiresAt: fileObj.perpetual ? null : Number(fileObj.expiresAt || 0),
        perpetual: Boolean(fileObj.perpetual),
        seats: Number(fileObj.seats || 0),
        years: Number(fileObj.years || (fileObj.perpetual ? 0 : 1)),
        tier: String(fileObj.tier || 'enterprise').toLowerCase(),
        aiAgentsEnabled: fileObj.aiAgentsEnabled !== false,
        orderId: String(fileObj.orderId || ''),
        hardware: {
            hwid: String(fileObj.hardware?.hwid || ''),
            nodeFingerprint: String(fileObj.hardware?.nodeFingerprint || ''),
            sku: String(fileObj.hardware?.sku || PAK_PRODUCT.sku),
        },
        customer: {
            name: String(fileObj.customer?.name || ''),
            inn: String(fileObj.customer?.inn || ''),
            email: String(fileObj.customer?.email || ''),
        },
    };
    return JSON.stringify(clean);
}

/**
 * Подписать отдельный файл лицензии (base или addon) закрытым ключом Ed25519 центра сертификации.
 */
export function signLicenseFile(fileObj, authorityKeys) {
    const priv = crypto.createPrivateKey({
        key: Buffer.from(String(authorityKeys.privateKey), 'base64'),
        format: 'der',
        type: 'pkcs8',
    });
    const payload = canonicalLicenseFileString(fileObj);
    const signature = crypto.sign(null, Buffer.from(payload, 'utf8'), priv).toString('base64');
    return {
        ...fileObj,
        protocol: fileObj.protocol || LICENSE_FILE_PROTOCOL,
        issuer: fileObj.issuer || 'work.odant.org',
        issuerPublicKey: authorityKeys.publicKey,
        signature,
    };
}

/**
 * Проверить подпись отдельного файла лицензии Ed25519 строго по доверенным ключам центра сертификации ODANT
 * (поле fileObj.issuerPublicKey внутри файла НЕ является источником доверия).
 */
export function verifyLicenseFile(fileObj, publicKeyB64 = '') {
    if (!fileObj || typeof fileObj !== 'object' || !fileObj.signature)
        return false;
    const trustedKeys = resolveTrustedAuthorityKeys(publicKeyB64);
    const payload = canonicalLicenseFileString(fileObj);
    const sigBuf = Buffer.from(String(fileObj.signature), 'base64');
    for (const keyB64 of trustedKeys) {
        try {
            const pub = crypto.createPublicKey({
                key: Buffer.from(String(keyB64), 'base64'),
                format: 'der',
                type: 'spki',
            });
            if (crypto.verify(null, Buffer.from(payload, 'utf8'), pub, sigBuf))
                return true;
        }
        catch { /* try next trusted key */ }
    }
    return false;
}

/**
 * Сгенерировать подписанный токен владельца (owk1.<payload_b64url>.<sig_b64url>),
 * содержащий URL сервера поддержки (hubUrl), ID аккаунта владельца и секретный ключ для доступа локальной системы к ЛК.
 */
export function createOwnerAccessToken({
    hubUrl = 'https://work.odant.org',
    accountId = '',
    email = '',
    tokenId = '',
    secret = '',
    issuedAt = Date.now(),
} = {}, authorityKeys) {
    const payloadObj = {
        v: 1,
        hubUrl: String(hubUrl || 'https://work.odant.org').replace(/\/+$/, ''),
        accountId: String(accountId || ''),
        email: String(email || '').toLowerCase(),
        tokenId: String(tokenId || ('TOK-' + crypto.randomBytes(4).toString('hex').toUpperCase())),
        secret: String(secret || crypto.randomBytes(16).toString('hex')),
        issuedAt: Number(issuedAt || Date.now()),
        issuerPublicKey: authorityKeys?.publicKey || '',
    };
    const payloadB64 = Buffer.from(JSON.stringify(payloadObj), 'utf8').toString('base64url');
    let sigB64 = '';
    if (authorityKeys?.privateKey) {
        const priv = crypto.createPrivateKey({
            key: Buffer.from(String(authorityKeys.privateKey), 'base64'),
            format: 'der',
            type: 'pkcs8',
        });
        sigB64 = crypto.sign(null, Buffer.from(`${OWNER_TOKEN_PREFIX}.${payloadB64}`, 'utf8'), priv).toString('base64url');
    }
    return {
        token: `${OWNER_TOKEN_PREFIX}.${payloadB64}.${sigB64}`,
        payload: payloadObj,
    };
}

/**
 * Распарсить токен владельца (owk1.<payload_b64url>.<sig_b64url>) и извлечь зашитый URL сервера поддержки и реквизиты.
 */
export function parseOwnerAccessToken(tokenStr = '') {
    const raw = String(tokenStr || '').trim();
    const parts = raw.split('.');
    if (parts.length !== 3 || parts[0] !== OWNER_TOKEN_PREFIX) {
        throw new Error('Некорректный формат токена владельца (ожидается owk1.<payload>.<signature>)');
    }
    try {
        const json = Buffer.from(parts[1], 'base64url').toString('utf8');
        const payload = JSON.parse(json);
        if (!payload?.hubUrl || !payload?.accountId || !payload?.tokenId) {
            throw new Error('В токене отсутствуют обязательные поля hubUrl / accountId / tokenId');
        }
        return {
            token: raw,
            prefix: parts[0],
            payloadB64: parts[1],
            signatureB64: parts[2],
            payload,
        };
    }
    catch (err) {
        throw new Error(`Не удалось декодировать токен владельца: ${err?.message || err}`);
    }
}

/**
 * Проверить криптографическую подпись Ed25519 токена владельца строго по доверенным ключам центра сертификации ODANT
 * (поле payload.issuerPublicKey внутри токена НЕ является источником доверия).
 */
export function verifyOwnerAccessToken(tokenStr = '', trustedPublicKeyB64 = '') {
    try {
        const parsed = parseOwnerAccessToken(tokenStr);
        if (!parsed.signatureB64)
            return false;
        const trustedKeys = resolveTrustedAuthorityKeys(trustedPublicKeyB64);
        const signedData = Buffer.from(`${OWNER_TOKEN_PREFIX}.${parsed.payloadB64}`, 'utf8');
        const sigBuf = Buffer.from(parsed.signatureB64, 'base64url');
        for (const keyB64 of trustedKeys) {
            try {
                const pub = crypto.createPublicKey({
                    key: Buffer.from(String(keyB64), 'base64'),
                    format: 'der',
                    type: 'spki',
                });
                if (crypto.verify(null, signedData, pub, sigBuf))
                    return true;
            }
            catch { /* try next trusted key */ }
        }
        return false;
    }
    catch {
        return false;
    }
}
