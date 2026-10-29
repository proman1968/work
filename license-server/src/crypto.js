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
 * Загрузить или сгенерировать ключевую пару Ed25519 центра лицензирования.
 */
export function loadOrCreateAuthorityKeys(keyFilePath) {
    if (keyFilePath && fs.existsSync(keyFilePath)) {
        try {
            const raw = JSON.parse(fs.readFileSync(keyFilePath, 'utf8'));
            if (raw?.publicKey && raw?.privateKey)
                return raw;
        }
        catch { /* создадим заново */ }
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
 * Проверить подпись сертификата лицензии.
 */
export function verifyCertificate(lic, publicKeyB64 = '') {
    if (!lic || typeof lic !== 'object' || !lic.signature)
        return false;
    const pubKey = publicKeyB64 || lic.issuerPublicKey;
    if (!pubKey)
        return false;
    try {
        const pub = crypto.createPublicKey({
            key: Buffer.from(String(pubKey), 'base64'),
            format: 'der',
            type: 'spki',
        });
        const payload = canonicalLicenseString(lic);
        return crypto.verify(
            null,
            Buffer.from(payload, 'utf8'),
            pub,
            Buffer.from(String(lic.signature), 'base64')
        );
    }
    catch {
        return false;
    }
}
