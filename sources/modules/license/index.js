/**
 * Клиентский модуль лицензирования и автообновления ПАК WORK (sources/modules/license/index.js).
 *
 * Реализует механику автономных машин AMD Ryzen™ AI Max+ PRO 495 (192 ГБ):
 *  1. Сразу после установки через npm и регистрации первого пользователя (BOSS) система полностью
 *     функциональна, кроме агентской ИИ-системы, и допускает только 1 сессию (BOSS) для настройки.
 *  2. Ограничения снимаются при получении первичной постоянной лицензии (10 вечных пользователей).
 *  3. Дополнительно могут добавляться временные лицензии (на N конкурентных пользователей кратно годам).
 *  4. Лицензии хранятся подписанными файлами (.lic.json) в папке #system и связаны с аккаунтом владельца.
 *  5. Владелец в личном кабинете work.odant.org генерирует токен (owk1...), содержащий URL сервера поддержки,
 *     и привязывает его через хендлер WORK (license_bind_token).
 *  6. Получив токен, WORK автоматически запрашивает и обновляет свои файлы лицензий из личного кабинета.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { serverKeys, fingerprint } from '../nodes/identity.js';
import { serverId } from '../../host/server-id.js';
import {
    ensurePackageManifest,
    loadAutoUpdateState,
    saveAutoUpdateState,
    checkForNpmUpdates,
    checkAndApplyNpmUpdate,
} from '../../host/auto-updater.js';

export const LICENSE_PROTOCOL = 'WORK-LIC-v1';
export const LICENSE_FILE_PROTOCOL = 'WORK-LIC-FILE-v1';
export const OWNER_TOKEN_PREFIX = 'owk1';
export const DEFAULT_LICENSE_HUB_URL = process.env.WORK_LICENSE_HUB_URL || 'https://work.odant.org';

/**
 * Жёстко зашитые (pinned) публичные ключи центра сертификации Правообладателя ODANT (Ed25519 SPKI DER base64).
 * Локальный клиент odant-work доверяет ТОЛЬКО этим ключам и никогда не доверяет полю issuerPublicKey
 * внутри пришедшего извне файла лицензии или токена (защита от поддельного/стороннего license-server).
 */
export const ODANT_AUTHORITY_PUBLIC_KEY = 'MCowBQYDK2VwAyEApVwPnoJcmUKLq4CLh7KdVHg1o5hfPiM7Lj9Eyq/VRdU=';
export const ODANT_BACKUP_PUBLIC_KEY = 'MCowBQYDK2VwAyEAdlQSj+pC3IOt60vo3lXkzpd0DFU4ZmADqEYQsW1+mRA=';
export const ODANT_CLOUD_PUBLIC_KEY = 'MCowBQYDK2VwAyEAg2zUcC+DHQ1dr0yo862COe+Yz4xD+xBaFrE5GvLvJEI=';
export const TRUSTED_AUTHORITY_PUBLIC_KEYS = Object.freeze([
    ODANT_AUTHORITY_PUBLIC_KEY,
    ODANT_BACKUP_PUBLIC_KEY,
    ODANT_CLOUD_PUBLIC_KEY,
]);

/**
 * Сформировать список доверенных публичных ключей центра сертификации (без доверия к полям внутри сертификата).
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

const SYSTEM_DIR = './#system';
const LICENSE_FILE = './#system/license.json';
const OWNER_TOKEN_FILE = './#system/owner-token.json';

/** Эталонная спецификация базового комплекса ODANT-WORK. */
export const PAK_HARDWARE_SPEC = Object.freeze({
    sku: 'WORK-PAK-495-192-4T',
    baseLicenseSku: 'WORK-LIC-BASE-10',
    title: 'ODANT-WORK (Программно-аппаратный комплекс)',
    cpu: 'AMD Ryzen™ AI Max+ PRO 495 (16 ядер / 32 потока Zen 5, до 5.2 ГГц)',
    gpu: 'AMD Radeon™ 8065S Graphics (40 ядер, 3000 МГц, до 61 TFLOPS FP16)',
    npu: 'AMD Ryzen™ AI (до 132 TOPS общий ИИ / 55 TOPS NPU)',
    ram: '192 ГБ 256-bit LPDDR5x-8533 Unified Memory',
    ramGb: 192,
    ssd: 'SSD 4 ТБ NVMe PCIe 4.0 (RAID0/RAID1)',
    ssdTb: 4,
    security: 'AMD PRO Technologies, AMD Memory Guard, AMD Secure Processor',
    basePriceRub: 5_000_000,
    baseLicensePriceRub: 4_000_000,
    baseSeats: 10,
    unlicensedBossSeats: 1,
    perpetualBase: true,
    includedSupportYears: 1,
    includedSupportTier: 'enterprise',
    postYearPolicy: 'Дальнейшее продление поддержки и докупка мест — по желанию (10 вечных лицензий работают бессрочно)',
    modelsPolicy: 'Интегрированные локальные модели предназначены для базовых операций; более мощные ИИ можно подключать через API из любого источника',
    configuration: 'Встроенная система учёта, документооборота, управления процессами и приватный мультимодальный ИИ (справочники, план счетов, двойная запись, ведомости, первичные документы, сквозные процессы и корпоративные коммуникации)',
    preinstalledModels: Object.freeze([
        {
            id: 'Qwen3-30B-A3B',
            category: 'llm',
            title: 'Большая языковая модель (LLM)',
            role: 'Диалог, ведение учёта, документооборот, управление процессами, аналитика и генерация кода',
            path: '/MODELS/Local/Qwen3-30B-A3B',
            ramEstimateGb: 18.5,
        },
        {
            id: 'Qwen3-Voice',
            category: 'voice',
            title: 'Голосовая модель (ASR + TTS)',
            role: 'Полнодуплексный голосовой диалог с перебиванием, распознавание и синтез естественной речи',
            path: '/MODELS/Local/Qwen3-Voice',
            ramEstimateGb: 4.2,
        },
        {
            id: 'Flux-Image',
            category: 'image',
            title: 'Модель генерации изображений',
            role: 'Локальный синтез иллюстраций, карточек товаров, схем и визуальных материалов',
            path: '/MODELS/Local/Flux-Image',
            ramEstimateGb: 12.0,
        },
        {
            id: 'Qwen3-Embedding',
            category: 'embedding',
            title: 'Модель векторного поиска (Embedding / RAG)',
            role: 'Семантический поиск и индексация договоров, первичных документов, проводок и базы знаний',
            path: '/MODELS/Local/Qwen3-Embedding',
            ramEstimateGb: 2.5,
        },
    ]),
});

/** Уровни годовой поддержки и стоимость дополнительной годовой лицензии на 1 пользователя. */
export const SUPPORT_TIERS = Object.freeze({
    start: Object.freeze({
        id: 'start',
        name: 'Start',
        pricePerUserYearRub: 10_000,
        ticketsPerSeatYear: 12,
        reactionMinutes: 480,
        reactionText: 'до 8 рабочих часов',
        scheduleText: '5/2 (09:00–18:00 МСК)',
        channels: ['MAX', 'Telegram', 'VK'],
        description: 'Базовый уровень поддержки: до 12 обращений в год на место, время реакции до 8 рабочих часов, обновления релизов.',
    }),
    business: Object.freeze({
        id: 'business',
        name: 'Business',
        pricePerUserYearRub: 15_000,
        ticketsPerSeatYear: 48,
        reactionMinutes: 120,
        reactionText: 'до 2 часов',
        scheduleText: '7 дней в неделю (08:00–22:00 МСК)',
        channels: ['MAX', 'Telegram', 'VK'],
        description: 'Бизнес-поддержка: до 48 обращений в год на место, время реакции до 2 часов, помощь по настройке учёта, процессов и моделей ИИ.',
    }),
    enterprise: Object.freeze({
        id: 'enterprise',
        name: 'Enterprise',
        pricePerUserYearRub: 20_000,
        ticketsPerSeatYear: 9999,
        reactionMinutes: 15,
        reactionText: 'до 15 минут (24/7)',
        scheduleText: '24/7/365 (круглосуточно)',
        channels: ['MAX', 'Telegram', 'VK', 'Выделенный инженер'],
        description: 'Приоритетная поддержка 24/7: безлимитные обращения, реакция до 15 минут, персональный инженер и помощь в дообучении моделей.',
    }),
});

/**
 * Каноническая сериализация тела сводного сертификата лицензии для подписи и верификации Ed25519.
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
            sku: String(lic.hardware?.sku || PAK_HARDWARE_SPEC.sku),
        },
        baseSeats: Number(lic.baseSeats ?? PAK_HARDWARE_SPEC.baseSeats),
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
 * Каноническая сериализация отдельного файла лицензии (.lic.json), размещаемого в #system.
 */
export function canonicalLicenseFileString(fileObj = {}) {
    const clean = {
        protocol: fileObj.protocol || LICENSE_FILE_PROTOCOL,
        fileId: String(fileObj.fileId || ''),
        kind: String(fileObj.kind || 'base'),
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
            sku: String(fileObj.hardware?.sku || PAK_HARDWARE_SPEC.sku),
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
 * Подписать объект лицензии закрытым ключом Ed25519 (PKCS8 DER base64).
 */
export function signLicenseCertificate(lic, privateKeyB64, publicKeyB64 = '') {
    const priv = crypto.createPrivateKey({
        key: Buffer.from(String(privateKeyB64), 'base64'),
        format: 'der',
        type: 'pkcs8',
    });
    const payload = canonicalLicenseString(lic);
    const sig = crypto.sign(null, Buffer.from(payload, 'utf8'), priv).toString('base64');
    return {
        ...lic,
        protocol: lic.protocol || LICENSE_PROTOCOL,
        issuerPublicKey: publicKeyB64 || lic.issuerPublicKey || '',
        signature: sig,
    };
}

/**
 * Проверить подпись Ed25519 сертификата лицензии строго по вшитым доверенным ключам Правообладателя ODANT.
 * Поле lic.issuerPublicKey внутри сертификата НЕ является источником доверия.
 */
export function verifyLicenseCertificate(lic, trustedPublicKeyB64 = '') {
    if (!lic || typeof lic !== 'object' || !lic.signature)
        return false;
    const trustedKeys = resolveTrustedAuthorityKeys(trustedPublicKeyB64);
    const payload = canonicalLicenseString(lic);
    const sigBuf = Buffer.from(String(lic.signature), 'base64');
    for (const pubB64 of trustedKeys) {
        try {
            const pub = crypto.createPublicKey({
                key: Buffer.from(String(pubB64), 'base64'),
                format: 'der',
                type: 'spki',
            });
            if (crypto.verify(null, Buffer.from(payload, 'utf8'), pub, sigBuf))
                return true;
        }
        catch { /* пробуем следующий доверенный ключ */ }
    }
    return false;
}

/**
 * Проверить подпись Ed25519 отдельного файла лицензии (.lic.json в папке #system)
 * строго по вшитым доверенным ключам Правообладателя ODANT.
 */
export function verifyLicenseFile(fileObj, trustedPublicKeyB64 = '') {
    if (!fileObj || typeof fileObj !== 'object' || !fileObj.signature)
        return false;
    const trustedKeys = resolveTrustedAuthorityKeys(trustedPublicKeyB64);
    const payload = canonicalLicenseFileString(fileObj);
    const sigBuf = Buffer.from(String(fileObj.signature), 'base64');
    for (const pubB64 of trustedKeys) {
        try {
            const pub = crypto.createPublicKey({
                key: Buffer.from(String(pubB64), 'base64'),
                format: 'der',
                type: 'spki',
            });
            if (crypto.verify(null, Buffer.from(payload, 'utf8'), pub, sigBuf))
                return true;
        }
        catch { /* пробуем следующий доверенный ключ */ }
    }
    return false;
}

/**
 * Распарсить токен владельца (owk1.<payload_b64url>.<sig_b64url>), содержащий URL сервера поддержки.
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
 * Проверить криптографическую подпись Ed25519 токена владельца строго по вшитым доверенным ключам ODANT.
 * Поле payload.issuerPublicKey внутри самого токена НЕ является источником доверия.
 */
export function verifyOwnerAccessToken(tokenStr = '', trustedPublicKeyB64 = '') {
    try {
        const parsed = parseOwnerAccessToken(tokenStr);
        if (!parsed.signatureB64)
            return false;
        const trustedKeys = resolveTrustedAuthorityKeys(trustedPublicKeyB64);
        const signedData = Buffer.from(`${OWNER_TOKEN_PREFIX}.${parsed.payloadB64}`, 'utf8');
        const sigBuf = Buffer.from(parsed.signatureB64, 'base64url');
        for (const pubB64 of trustedKeys) {
            try {
                const pub = crypto.createPublicKey({
                    key: Buffer.from(String(pubB64), 'base64'),
                    format: 'der',
                    type: 'spki',
                });
                if (crypto.verify(null, signedData, pub, sigBuf))
                    return true;
            }
            catch { /* пробуем следующий доверенный ключ */ }
        }
        return false;
    }
    catch {
        return false;
    }
}

/**
 * Сохранить привязанный токен владельца в #system/owner-token.json (с обязательной проверкой подписи центра ODANT).
 */
export function saveOwnerTokenBinding(tokenStr, { systemDir = SYSTEM_DIR, canonicalHubUrl = '', trustedPublicKey = '' } = {}) {
    const parsed = parseOwnerAccessToken(tokenStr);
    if (!verifyOwnerAccessToken(tokenStr, trustedPublicKey)) {
        const err = new Error(
            'Токен владельца отклонён: подпись не принадлежит официальному центру сертификации ODANT '
            + '(поддельный или неподтверждённый сервер лицензий).'
        );
        err.code = 'UNTRUSTED_LICENSE_SERVER';
        throw err;
    }
    const hubUrl = String(canonicalHubUrl || parsed.payload.hubUrl || DEFAULT_LICENSE_HUB_URL).replace(/\/+$/, '');
    const record = {
        token: parsed.token,
        hubUrl,
        accountId: parsed.payload.accountId,
        email: parsed.payload.email || '',
        licenseId: parsed.payload.licenseId || '',
        serverName: parsed.payload.serverName || '',
        tokenId: parsed.payload.tokenId,
        issuedAt: parsed.payload.issuedAt || Date.now(),
        boundAt: Date.now(),
    };
    const filePath = path.join(systemDir, 'owner-token.json');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(record, null, 2), 'utf8');
    fs.renameSync(tmp, filePath);
    return record;
}

/**
 * Прочитать привязанный токен владельца из #system/owner-token.json.
 */
export function loadOwnerTokenBinding(systemDir = SYSTEM_DIR) {
    try {
        const filePath = path.join(systemDir, 'owner-token.json');
        if (fs.existsSync(filePath)) {
            const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            if (parsed?.token && parsed?.hubUrl)
                return parsed;
        }
    }
    catch { /* ignore */ }
    return null;
}

/**
 * Сохранить отдельные файлы лицензий (.lic.json) в папку #system (только после проверки подписи ODANT).
 */
export function saveLicenseFilesToSystem(licenseFiles = [], systemDir = SYSTEM_DIR, { trustedPublicKey = '', replaceExisting = false } = {}) {
    if (!Array.isArray(licenseFiles))
        return [];
    fs.mkdirSync(systemDir, { recursive: true });
    const saved = [];
    const expectedNames = new Set();
    for (const item of licenseFiles) {
        const fileObj = item?.licenseFile || item;
        if (!fileObj || typeof fileObj !== 'object' || !fileObj.fileId)
            continue;
        if (!verifyLicenseFile(fileObj, trustedPublicKey)) {
            const err = new Error(
                `Файл лицензии ${fileObj.fileId} отклонён: подпись не принадлежит официальному центру сертификации ODANT.`
            );
            err.code = 'UNTRUSTED_LICENSE_FILE';
            throw err;
        }
        const safeName = String(item?.fileName || `license-${fileObj.kind || 'base'}-${fileObj.fileId}.lic.json`)
            .replace(/[^a-zA-Z0-9._-]/g, '_');
        expectedNames.add(safeName);
        const fullPath = path.join(systemDir, safeName);
        const tmp = `${fullPath}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(fileObj, null, 2), 'utf8');
        fs.renameSync(tmp, fullPath);
        saved.push({ fileName: safeName, path: fullPath, kind: fileObj.kind, fileId: fileObj.fileId, seats: fileObj.seats });
    }
    if (replaceExisting) {
        try {
            for (const name of fs.readdirSync(systemDir)) {
                if (name.endsWith('.lic.json') && !expectedNames.has(name)) {
                    try { fs.unlinkSync(path.join(systemDir, name)); } catch { /* ignore */ }
                }
            }
        }
        catch { /* ignore */ }
    }
    return saved;
}

/**
 * Прочитать все отдельные файлы лицензий (*.lic.json) из папки #system и проверить их подпись Ed25519.
 */
export function loadLicenseFilesFromSystem(systemDir = SYSTEM_DIR, { trustedPublicKey = '' } = {}) {
    const result = [];
    try {
        if (!fs.existsSync(systemDir))
            return result;
        const entries = fs.readdirSync(systemDir);
        for (const name of entries) {
            if (!name.endsWith('.lic.json'))
                continue;
            const fullPath = path.join(systemDir, name);
            try {
                const raw = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
                if (raw && typeof raw === 'object' && (raw.kind === 'base' || raw.kind === 'addon')) {
                    result.push({
                        fileName: name,
                        path: fullPath,
                        ...raw,
                        signatureValid: verifyLicenseFile(raw, trustedPublicKey),
                    });
                }
            }
            catch { /* skip broken */ }
        }
    }
    catch { /* ignore */ }
    return result;
}

/**
 * Вычислить аппаратный идентификатор ПАК (HWID + отпечаток узла WORK).
 */
export function getHardwareIdentity() {
    const cpus = os.cpus() || [];
    const cpuModel = cpus[0]?.model?.trim() || PAK_HARDWARE_SPEC.cpu;
    const cpuCores = cpus.length || 32;
    const totalMemGb = Math.round((os.totalmem() / (1024 ** 3)) * 10) / 10;
    const keys = serverKeys();
    const nodeFp = fingerprint(keys.publicKey);
    const srvId = typeof serverId === 'function' ? serverId() : String(serverId || '');
    const raw = [cpuModel, cpuCores, Math.round(totalMemGb), keys.publicKey, srvId].join('|');
    const hash = crypto.createHash('sha256').update(raw, 'utf8').digest('hex').slice(0, 16).toUpperCase();
    const hwid = 'PAK-' + hash.match(/.{4}/g).join('-');
    return {
        hwid,
        serverId: srvId,
        nodeFingerprint: nodeFp,
        nodePublicKey: keys.publicKey,
        detectedCpu: cpuModel,
        detectedCores: cpuCores,
        detectedRamGb: totalMemGb,
        pakSpec: PAK_HARDWARE_SPEC,
    };
}

/**
 * Прочитать локальную лицензию из #system/license.json и файлов *.lic.json в #system.
 * Если ни одного файла лицензии в #system ещё нет — возвращает состояние неактивированной системы
 * (baseActivated: false, 1 сессия для BOSS, агентская система отключена).
 */
export function loadLocalLicense(customPath, { systemDir, trustedPublicKey = '' } = {}) {
    const resolvedSystemDir = systemDir || (customPath && customPath !== LICENSE_FILE ? path.dirname(customPath) : SYSTEM_DIR);
    const resolvedCustomPath = customPath || path.join(resolvedSystemDir, 'license.json');
    let certFromJson = null;
    try {
        if (fs.existsSync(resolvedCustomPath)) {
            const parsed = JSON.parse(fs.readFileSync(resolvedCustomPath, 'utf8'));
            if (parsed && typeof parsed === 'object') {
                const sigOk = parsed.signature
                    ? (verifyLicenseCertificate(parsed, trustedPublicKey) || verifyLicenseFile(parsed, trustedPublicKey))
                    : false;
                if (sigOk)
                    certFromJson = parsed;
            }
        }
    }
    catch { /* ignore */ }

    const licFiles = loadLicenseFilesFromSystem(resolvedSystemDir, { trustedPublicKey });
    const baseFile = licFiles.find(f => f.kind === 'base' && f.signatureValid === true);
    const addonFiles = licFiles.filter(f => f.kind === 'addon' && f.signatureValid === true);
    const tokenBinding = loadOwnerTokenBinding(resolvedSystemDir);

    if (certFromJson || baseFile || addonFiles.length > 0) {
        const hw = getHardwareIdentity();
        const now = Date.now();
        const oneYearMs = 365 * 24 * 3600_000;
        const baseActivated = Boolean(
            (baseFile && baseFile.aiAgentsEnabled !== false)
            || (certFromJson && certFromJson.baseActivated !== false && certFromJson.signature)
        );

        // Объединяем подписки из сводного сертификата и отдельных файлов license-addon-*.lic.json
        const mergedAddonsMap = new Map();
        for (const sub of (certFromJson?.addonSubscriptions || [])) {
            if (sub?.id) mergedAddonsMap.set(sub.id, sub);
        }
        for (const af of addonFiles) {
            mergedAddonsMap.set(af.fileId, {
                id: af.fileId,
                tier: af.tier || 'business',
                seats: Number(af.seats || 0),
                years: Number(af.years || 1),
                issuedAt: Number(af.issuedAt || now),
                expiresAt: Number(af.expiresAt || 0),
                orderId: af.orderId || '',
                status: 'active',
                fileName: af.fileName,
            });
        }

        const issuedAt = Number(baseFile?.issuedAt || certFromJson?.issuedAt || now);
        return {
            protocol: LICENSE_PROTOCOL,
            licenseId: baseFile?.licenseId || certFromJson?.licenseId || ('PAK-BASE-' + hw.hwid.replace(/^PAK-/, '')),
            ownerAccountId: baseFile?.ownerAccountId || certFromJson?.ownerAccountId || tokenBinding?.accountId || '',
            ownerEmail: baseFile?.ownerEmail || certFromJson?.ownerEmail || tokenBinding?.email || '',
            baseActivated,
            issuedAt,
            issuer: baseFile?.issuer || certFromJson?.issuer || 'work.odant.org',
            customer: baseFile?.customer || certFromJson?.customer || { name: 'Владелец ПАК WORK', inn: '', email: '' },
            hardware: baseFile?.hardware || certFromJson?.hardware || {
                hwid: hw.hwid,
                nodeFingerprint: hw.nodeFingerprint,
                sku: PAK_HARDWARE_SPEC.sku,
            },
            baseSeats: baseActivated ? Number(baseFile?.seats ?? certFromJson?.baseSeats ?? PAK_HARDWARE_SPEC.baseSeats) : 0,
            perpetualBase: baseActivated,
            addonSubscriptions: [...mergedAddonsMap.values()],
            support: certFromJson?.support || {
                tier: baseFile?.tier || PAK_HARDWARE_SPEC.includedSupportTier,
                includedUntil: issuedAt + oneYearMs,
                ticketsUsed: 0,
                bindCode: '',
            },
            issuerPublicKey: certFromJson?.issuerPublicKey || baseFile?.issuerPublicKey || '',
            signature: certFromJson?.signature || baseFile?.signature || '',
            signatureValid: true,
            hubUrl: tokenBinding?.hubUrl || certFromJson?.hubUrl || DEFAULT_LICENSE_HUB_URL,
            licenseFilesCount: licFiles.filter(f => f.signatureValid).length,
        };
    }

    // Состояние сразу после локальной установки системы (до получения первичной постоянной лицензии):
    // доступна 1 сессия (для первого пользователя BOSS), агентская система отключена.
    const hw = getHardwareIdentity();
    const now = Date.now();
    return {
        protocol: LICENSE_PROTOCOL,
        licenseId: 'PAK-UNLICENSED-' + hw.hwid.replace(/^PAK-/, ''),
        ownerAccountId: tokenBinding?.accountId || '',
        ownerEmail: tokenBinding?.email || '',
        baseActivated: false,
        unlicensed: true,
        issuedAt: now,
        issuer: 'work.odant.org',
        customer: {
            name: 'Локальная установка ODANT-WORK (ожидает привязки лицензии)',
            inn: '',
            email: tokenBinding?.email || '',
        },
        hardware: {
            hwid: hw.hwid,
            nodeFingerprint: hw.nodeFingerprint,
            sku: PAK_HARDWARE_SPEC.sku,
            cpu: PAK_HARDWARE_SPEC.cpu,
            ramGb: PAK_HARDWARE_SPEC.ramGb,
            ssdTb: PAK_HARDWARE_SPEC.ssdTb,
        },
        baseSeats: 0,
        perpetualBase: false,
        addonSubscriptions: [],
        support: {
            tier: 'start',
            includedUntil: 0,
            ticketsUsed: 0,
            bindCode: '',
        },
        hubUrl: tokenBinding?.hubUrl || DEFAULT_LICENSE_HUB_URL,
        licenseFilesCount: 0,
    };
}

/**
 * Сохранить лицензию в #system/license.json.
 */
export function saveLocalLicense(lic, customPath = LICENSE_FILE) {
    const dir = path.dirname(customPath);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${customPath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(lic, null, 2), 'utf8');
    fs.renameSync(tmp, customPath);
    return lic;
}

/**
 * Рассчитать действующие рабочие места, статус агентской системы и активный уровень поддержки на текущий момент.
 */
export function evaluateLicenseState(lic = loadLocalLicense(), now = Date.now(), { trustedPublicKey = '' } = {}) {
    const signed = !!lic.signature;
    const signatureValid = signed
        ? (lic.signatureValid === true || verifyLicenseCertificate(lic, trustedPublicKey) || verifyLicenseFile(lic, trustedPublicKey))
        : false;
    // Если сертификат подписан, но подпись не принадлежит доверенному центру сертификации ODANT — лицензия отвергается
    const isBaseLicensed = (!signed || signatureValid)
        && lic.baseActivated !== false
        && !lic.unlicensed
        && Number(lic.baseSeats ?? PAK_HARDWARE_SPEC.baseSeats) > 0;
    const baseSeats = isBaseLicensed ? Math.max(0, Number(lic.baseSeats ?? PAK_HARDWARE_SPEC.baseSeats)) : 0;
    const unlicensedBossSeats = isBaseLicensed ? 0 : PAK_HARDWARE_SPEC.unlicensedBossSeats;
    const aiAgentsEnabled = isBaseLicensed;

    const subs = Array.isArray(lic.addonSubscriptions) ? lic.addonSubscriptions : [];
    const activeSubs = [];
    const expiredSubs = [];

    let addonSeats = 0;
    let highestTier = null;
    let totalTicketsQuota = 0;
    let nearestExpiry = null;

    const tierRank = { start: 1, business: 2, enterprise: 3 };
    const oneYearMs = 365 * 24 * 3600_000;
    const baseSupportUntil = isBaseLicensed
        ? Number(lic.support?.includedUntil || ((Number(lic.issuedAt) || now) + oneYearMs))
        : 0;
    const baseSupportActive = isBaseLicensed && baseSupportUntil > now;

    if (baseSupportActive) {
        const baseTierKey = String(lic.support?.tier || PAK_HARDWARE_SPEC.includedSupportTier || 'enterprise').toLowerCase();
        const baseTierSpec = SUPPORT_TIERS[baseTierKey] || SUPPORT_TIERS.enterprise;
        highestTier = baseTierKey;
        totalTicketsQuota += baseSeats * baseTierSpec.ticketsPerSeatYear;
        nearestExpiry = baseSupportUntil;
    }

    for (const sub of subs) {
        if (!sub || sub.status === 'canceled' || sub.status === 'revoked')
            continue;
        const exp = Number(sub.expiresAt || 0);
        const seats = Math.max(0, Number(sub.seats || 0));
        const tierKey = String(sub.tier || 'start').toLowerCase();
        const tierSpec = SUPPORT_TIERS[tierKey] || SUPPORT_TIERS.start;
        if (exp > now && seats > 0) {
            activeSubs.push({ ...sub, tierSpec });
            addonSeats += seats;
            totalTicketsQuota += seats * tierSpec.ticketsPerSeatYear;
            if (!highestTier || (tierRank[tierKey] || 0) > (tierRank[highestTier] || 0))
                highestTier = tierKey;
            if (nearestExpiry === null || exp < nearestExpiry)
                nearestExpiry = exp;
        }
        else {
            expiredSubs.push(sub);
        }
    }

    const effectiveTierKey = highestTier || String(lic.support?.tier || 'start').toLowerCase();
    const effectiveTier = SUPPORT_TIERS[effectiveTierKey] || SUPPORT_TIERS.start;
    if (isBaseLicensed && totalTicketsQuota === 0) {
        totalTicketsQuota = baseSeats * SUPPORT_TIERS.start.ticketsPerSeatYear;
    }

    const hw = getHardwareIdentity();
    const hardwareMatch = (!lic.hardware?.hwid || lic.hardware.hwid === hw.hwid)
        && (!lic.hardware?.nodeFingerprint || lic.hardware.nodeFingerprint === hw.nodeFingerprint);

    const totalSeats = isBaseLicensed ? (baseSeats + addonSeats) : unlicensedBossSeats;

    return {
        licenseId: lic.licenseId,
        ownerAccountId: lic.ownerAccountId || '',
        ownerEmail: lic.ownerEmail || '',
        baseLicensed: isBaseLicensed,
        aiAgentsEnabled,
        issuer: lic.issuer || 'work.odant.org',
        issuedAt: lic.issuedAt || now,
        customer: lic.customer || {},
        hardware: lic.hardware || {},
        hardwareMatch,
        baseSeats,
        unlicensedBossSeats,
        perpetualBase: isBaseLicensed && lic.perpetualBase !== false,
        addonSeats,
        totalSeats,
        activeSubscriptions: activeSubs,
        expiredSubscriptions: expiredSubs,
        nearestExpiry,
        baseSupportUntil,
        baseSupportActive,
        support: {
            active: baseSupportActive || activeSubs.length > 0,
            tier: effectiveTier.id,
            tierName: effectiveTier.name,
            reactionMinutes: effectiveTier.reactionMinutes,
            reactionText: effectiveTier.reactionText,
            scheduleText: effectiveTier.scheduleText,
            ticketsQuota: totalTicketsQuota,
            ticketsUsed: Number(lic.support?.ticketsUsed || 0),
            ticketsRemaining: Math.max(0, totalTicketsQuota - Number(lic.support?.ticketsUsed || 0)),
            bindCode: lic.support?.bindCode || '',
            channels: effectiveTier.channels,
        },
        signed,
        signatureValid,
        hubUrl: lic.hubUrl || DEFAULT_LICENSE_HUB_URL,
    };
}

/**
 * Проверить, разрешена ли работа агентской ИИ-системы (требуется первичная постоянная лицензия).
 */
export function assertAgentSystemLicensed(options = {}) {
    const lic = options.license || loadLocalLicense(options.licensePath, { systemDir: options.systemDir });
    const state = evaluateLicenseState(lic, options.now);
    if (!state.aiAgentsEnabled) {
        const err = new Error(
            'Агентская ИИ-система отключена до получения первичной постоянной лицензии (10 вечных пользователей). '
            + 'Зарегистрируйтесь в личном кабинете на work.odant.org, получите токен владельца и привяжите его в разделе «Лицензирование».'
        );
        err.code = 'LICENSE_REQUIRED';
        throw err;
    }
    return true;
}

/**
 * Подсчитать одновременные активные пользовательские сессии (concurrent sessions в $server.sessions).
 */
export function getActiveWorkplaces(sessionsMap = globalThis.$server?.sessions) {
    const map = sessionsMap || {};
    const now = Date.now();
    const list = [];
    for (const [ssid, s] of Object.entries(map)) {
        if (!s?.uid || s.ephemeral || s.principal?.kind === 'node')
            continue;
        const hasOpenSocket = s.sockets && Object.values(s.sockets).some(sock => sock?.ws?.readyState === 1);
        const recentHttp = (now - (s.lastSeen || s.created || 0)) < 30 * 60_000;
        if (!hasOpenSocket && !recentHttp)
            continue;
        list.push({
            ssid: s.ssid || ssid,
            uid: s.uid,
            name: s.credentials?.label || s.credentials?.name || s.$user?.DATA?.label || s.uid,
            email: s.credentials?.email || s.$user?.DATA?.email || '',
            lastSeen: s.lastSeen || s.created || now,
            online: !!hasOpenSocket,
        });
    }
    return list;
}

/**
 * Проверить доступность одновременной пользовательской сессии (рабочего места) перед входом:
 *  - До активации базовой лицензии доступна только 1 сессия (для BOSS) для первичной настройки.
 *  - После активации базовой лицензии доступно 10 вечных + активные срочные годовые места.
 */
export function assertWorkplaceAvailableForLogin(uid, { sessions, currentSsid = '', license, isAdmin = false, systemDir } = {}) {
    if (!uid)
        return true;
    const licState = evaluateLicenseState(license || loadLocalLicense(LICENSE_FILE, { systemDir }));
    const activeSessions = getActiveWorkplaces(sessions);
    if (currentSsid && activeSessions.some(s => s.ssid === currentSsid))
        return true;

    if (!licState.baseLicensed) {
        if (!isAdmin && activeSessions.length >= 1) {
            throw new Error(
                'До активации первичной постоянной лицензии ODANT-WORK доступна только 1 сессия (BOSS) для настройки системы. '
                + `Привяжите токен личного кабинета владельца (${licState.hubUrl}) в разделе «Лицензирование».`
            );
        }
        if (activeSessions.length >= licState.totalSeats && !isAdmin) {
            throw new Error(
                'Система находится в режиме первичной настройки (1 сессия BOSS). Для работы сотрудников активируйте базовую лицензию на 10 вечных мест.'
            );
        }
        return true;
    }

    if (isAdmin)
        return true;
    if (activeSessions.length >= licState.totalSeats) {
        throw new Error(
            `Достигнут лимит одновременных сессий (рабочих мест) по лицензии ПАК WORK (${activeSessions.length} из ${licState.totalSeats}: `
            + `${licState.baseSeats} вечных + ${licState.addonSeats} годовых). `
            + `Для подключения дополнительных сотрудников оформите годовую лицензию (Start / Business / Enterprise) на ${licState.hubUrl}`
        );
    }
    return true;
}

/**
 * Проверить наличие предустановленных моделей ПАК в /MODELS/Local.
 */
export function inspectPreinstalledModels(rootDir = '.') {
    return PAK_HARDWARE_SPEC.preinstalledModels.map(m => {
        const rel = m.path.replace(/^\/+/, '');
        const classFile = path.join(rootDir, rel, '$ai', 'class.js');
        const weightsDir = path.join(rootDir, rel, '#weights');
        const configured = fs.existsSync(classFile);
        let weightsReady = false;
        try {
            if (fs.existsSync(weightsDir)) {
                const files = fs.readdirSync(weightsDir);
                weightsReady = files.some(f => /\.(safetensors|gguf|bin|onnx)$/i.test(f));
            }
        }
        catch { /* ignore */ }
        return {
            ...m,
            configured,
            weightsReady,
        };
    });
}

export const SEAT_VOLUME_DISCOUNTS = Object.freeze([
    { minSeats: 100, discountPercent: 25 },
    { minSeats: 50,  discountPercent: 20 },
    { minSeats: 25,  discountPercent: 15 },
    { minSeats: 10,  discountPercent: 10 },
    { minSeats: 5,   discountPercent: 5 },
    { minSeats: 1,   discountPercent: 0 },
]);

export function getVolumeDiscountPercent(seats = 1) {
    const count = Math.max(0, Math.floor(Number(seats || 0)));
    for (const d of SEAT_VOLUME_DISCOUNTS) {
        if (count >= d.minSeats)
            return d.discountPercent;
    }
    return 0;
}

/**
 * Полная сводка состояния ПАК, файлов лицензий в #system, привязанного токена и автообновления npm.
 */
export function getFullLicenseStatus(options = {}) {
    const sysDir = options.systemDir || (options.licensePath ? path.dirname(options.licensePath) : SYSTEM_DIR);
    const trustedPublicKey = options.trustedPublicKey || '';
    const lic = options.license || loadLocalLicense(options.licensePath || LICENSE_FILE, { systemDir: sysDir, trustedPublicKey });
    const state = evaluateLicenseState(lic, options.now, { trustedPublicKey });
    const hardware = getHardwareIdentity();
    const activeUsers = getActiveWorkplaces(options.sessions);
    const models = inspectPreinstalledModels(options.rootDir || '.');
    const licenseFiles = loadLicenseFilesFromSystem(sysDir, { trustedPublicKey });
    const tokenBinding = loadOwnerTokenBinding(sysDir);
    const autoUpdate = loadAutoUpdateState(options.rootDir || '.');

    return {
        ...state,
        activeSeatsCount: activeUsers.length,
        availableSeatsCount: Math.max(0, state.totalSeats - activeUsers.length),
        activeUsers,
        hardware,
        pakSpec: PAK_HARDWARE_SPEC,
        supportTiers: Object.values(SUPPORT_TIERS),
        volumeDiscounts: SEAT_VOLUME_DISCOUNTS,
        preinstalledModels: models,
        licenseFiles,
        tokenBinding: tokenBinding ? {
            bound: true,
            token: tokenBinding.token,
            hubUrl: tokenBinding.hubUrl,
            accountId: tokenBinding.accountId,
            email: tokenBinding.email,
            licenseId: tokenBinding.licenseId || '',
            serverName: tokenBinding.serverName || '',
            tokenId: tokenBinding.tokenId,
            boundAt: tokenBinding.boundAt,
        } : { bound: false, token: '' },
        autoUpdate,
    };
}

/**
 * Калькулятор стоимости заказа (базовый ПАК с машиной 5 млн ₽, отдельно базовая лицензия без железа 4 млн ₽,
 * дополнительные годовые лицензии кратно годам со скидкой от количества).
 */
export function calculateLicenseQuote({
    includeBasePak = false,
    includeBaseLicenseOnly = false,
    tier = 'business',
    addonSeats = 1,
    years = 1,
} = {}) {
    const tierKey = String(tier || 'business').toLowerCase();
    const tierSpec = SUPPORT_TIERS[tierKey] || SUPPORT_TIERS.business;
    const seatsCount = Math.max(0, Math.floor(Number(addonSeats || 0)));
    const yearsCount = Math.max(1, Math.min(5, Math.floor(Number(years || 1))));
    const discountPercent = getVolumeDiscountPercent(seatsCount);
    const hasFullPak = Boolean(includeBasePak);
    const hasBaseLicOnly = !hasFullPak && Boolean(includeBaseLicenseOnly);

    const baseRub = hasFullPak
        ? PAK_HARDWARE_SPEC.basePriceRub
        : (hasBaseLicOnly ? PAK_HARDWARE_SPEC.baseLicensePriceRub : 0);
    const addonsGrossRub = seatsCount * tierSpec.pricePerUserYearRub * yearsCount;
    const addonsDiscountRub = Math.round(addonsGrossRub * (discountPercent / 100));
    const addonsRub = addonsGrossRub - addonsDiscountRub;
    return {
        includeBasePak: hasFullPak,
        includeBaseLicenseOnly: hasBaseLicOnly,
        basePakPriceRub: hasFullPak ? PAK_HARDWARE_SPEC.basePriceRub : 0,
        baseLicenseOnlyPriceRub: hasBaseLicOnly ? PAK_HARDWARE_SPEC.baseLicensePriceRub : 0,
        baseSeatsIncluded: (hasFullPak || hasBaseLicOnly) ? PAK_HARDWARE_SPEC.baseSeats : 0,
        tier: tierSpec.id,
        tierName: tierSpec.name,
        pricePerUserYearRub: tierSpec.pricePerUserYearRub,
        addonSeats: seatsCount,
        years: yearsCount,
        volumeDiscountPercent: discountPercent,
        addonsGrossRub,
        addonsDiscountRub,
        addonsTotalRub: addonsRub,
        totalRub: baseRub + addonsRub,
        reactionText: tierSpec.reactionText,
        ticketsPerYear: seatsCount * tierSpec.ticketsPerSeatYear,
    };
}

/**
 * Привязать токен владельца (owk1...) к локальному WORK и сразу скачать файлы лицензий из личного кабинета в #system.
 */
export async function bindOwnerTokenAndSync({
    token,
    systemDir = SYSTEM_DIR,
    licensePath,
    trustedPublicKey = '',
    fetchImpl = globalThis.fetch,
} = {}) {
    const binding = saveOwnerTokenBinding(token, { systemDir, trustedPublicKey });
    const hw = getHardwareIdentity();
    const baseUrl = binding.hubUrl;

    const res = await fetchImpl(`${baseUrl}/api/license/sync-by-token`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${binding.token}`,
        },
        body: JSON.stringify({
            token: binding.token,
            hwid: hw.hwid,
            nodeFingerprint: hw.nodeFingerprint,
            nodePublicKey: hw.nodePublicKey,
            serverId: hw.serverId,
        }),
    });

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Сервер поддержки (${baseUrl}) отклонил привязку токена (HTTP ${res.status}): ${text.slice(0, 200)}`);
    }

    const data = await res.json();
    // Если сервер поддержки сообщил о переезде на новый домен (canonicalHubUrl) — обновляем сохранённый URL
    const effectiveHubUrl = String(data.canonicalHubUrl || baseUrl).replace(/\/+$/, '');
    if (effectiveHubUrl !== baseUrl) {
        saveOwnerTokenBinding(token, { systemDir, canonicalHubUrl: effectiveHubUrl, trustedPublicKey });
    }

    if (Array.isArray(data.licenseFiles)) {
        saveLicenseFilesToSystem(data.licenseFiles, systemDir, { trustedPublicKey, replaceExisting: true });
    }

    const targetLicPath = licensePath || path.join(systemDir, 'license.json');
    if (data.certificate) {
        if (!verifyLicenseCertificate(data.certificate, trustedPublicKey)) {
            const err = new Error('Сертификат лицензии отклонён: подпись не принадлежит официальному центру сертификации ODANT.');
            err.code = 'UNTRUSTED_LICENSE_CERTIFICATE';
            throw err;
        }
        const updated = {
            ...data.certificate,
            ownerAccountId: data.accountId || data.certificate.ownerAccountId || binding.accountId,
            ownerEmail: data.ownerEmail || data.certificate.ownerEmail || binding.email,
            baseActivated: data.baseActivated !== false,
            hubUrl: effectiveHubUrl,
        };
        saveLocalLicense(updated, targetLicPath);
        return getFullLicenseStatus({ license: updated, licensePath: targetLicPath, systemDir, trustedPublicKey });
    }

    return getFullLicenseStatus({ licensePath: targetLicPath, systemDir, trustedPublicKey });
}

/**
 * Отвязать токен владельца (owk1...) от локального WORK и удалить связанные файлы лицензий из #system.
 */
export function unbindOwnerToken({ systemDir = SYSTEM_DIR, licensePath } = {}) {
    const tokenFile = path.join(systemDir, 'owner-token.json');
    const targetLicPath = licensePath || path.join(systemDir, 'license.json');
    try { if (fs.existsSync(tokenFile)) fs.unlinkSync(tokenFile); } catch { /* ignore */ }
    try { if (fs.existsSync(targetLicPath)) fs.unlinkSync(targetLicPath); } catch { /* ignore */ }
    try {
        if (fs.existsSync(systemDir)) {
            for (const name of fs.readdirSync(systemDir)) {
                if (name.endsWith('.lic.json')) {
                    try { fs.unlinkSync(path.join(systemDir, name)); } catch { /* ignore */ }
                }
            }
        }
    }
    catch { /* ignore */ }
    return getFullLicenseStatus({ systemDir, licensePath: targetLicPath });
}

/**
 * Синхронизировать лицензию с сервером поддержки (по привязанному токену владельца или напрямую).
 */
export async function syncWithLicenseHub({ hubUrl, licensePath, systemDir, token, trustedPublicKey = '', fetchImpl = globalThis.fetch } = {}) {
    const sysDir = systemDir || (licensePath ? path.dirname(licensePath) : SYSTEM_DIR);
    const tokenBinding = loadOwnerTokenBinding(sysDir);
    const activeToken = token || tokenBinding?.token || '';

    if (activeToken) {
        return bindOwnerTokenAndSync({
            token: activeToken,
            systemDir: sysDir,
            licensePath: licensePath || path.join(sysDir, 'license.json'),
            trustedPublicKey,
            fetchImpl,
        });
    }

    const lic = loadLocalLicense(licensePath || LICENSE_FILE, { systemDir: sysDir, trustedPublicKey });
    const hw = getHardwareIdentity();
    const baseUrl = String(hubUrl || lic.hubUrl || DEFAULT_LICENSE_HUB_URL).replace(/\/+$/, '');
    const res = await fetchImpl(`${baseUrl}/api/license/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            licenseId: lic.unlicensed ? undefined : lic.licenseId,
            hwid: hw.hwid,
            nodeFingerprint: hw.nodeFingerprint,
            nodePublicKey: hw.nodePublicKey,
            customer: lic.customer,
        }),
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Сервер лицензий (${baseUrl}) ответил HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = await res.json();
    if (Array.isArray(data?.licenseFiles) && data.licenseFiles.length > 0) {
        saveLicenseFilesToSystem(data.licenseFiles, sysDir, { trustedPublicKey });
    }
    if (data?.certificate) {
        if (!verifyLicenseCertificate(data.certificate, trustedPublicKey)) {
            const err = new Error('Сертификат лицензии отклонён: подпись не принадлежит официальному центру сертификации ODANT.');
            err.code = 'UNTRUSTED_LICENSE_CERTIFICATE';
            throw err;
        }
        const updated = {
            ...lic,
            ...data.certificate,
            unlicensed: false,
            baseActivated: data.baseActivated !== false,
            hubUrl: baseUrl,
        };
        const targetPath = licensePath || path.join(sysDir, 'license.json');
        saveLocalLicense(updated, targetPath);
        return getFullLicenseStatus({ license: updated, licensePath: targetPath, systemDir: sysDir, trustedPublicKey });
    }
    return getFullLicenseStatus({ license: lic, licensePath, systemDir: sysDir, trustedPublicKey });
}

/**
 * Создать заказ (через ЮKassa или по договору/счёту для юрлиц) на сервере work.odant.org.
 */
export async function createHubCheckoutOrder(params = {}) {
    const sysDir = params.systemDir || (params.licensePath ? path.dirname(params.licensePath) : SYSTEM_DIR);
    const lic = loadLocalLicense(params.licensePath || LICENSE_FILE, { systemDir: sysDir });
    const tokenBinding = loadOwnerTokenBinding(sysDir);
    const hw = getHardwareIdentity();
    const baseUrl = String(params.hubUrl || tokenBinding?.hubUrl || lic.hubUrl || DEFAULT_LICENSE_HUB_URL).replace(/\/+$/, '');
    const payload = {
        licenseId: lic.unlicensed ? '' : lic.licenseId,
        ownerAccountId: tokenBinding?.accountId || lic.ownerAccountId || '',
        hwid: hw.hwid,
        nodeFingerprint: hw.nodeFingerprint,
        includeBasePak: !!params.includeBasePak,
        includeBaseLicenseOnly: !!params.includeBaseLicenseOnly,
        tier: params.tier || 'business',
        addonSeats: Math.max(0, Number(params.addonSeats ?? 1)),
        years: Math.max(1, Number(params.years || 1)),
        paymentMethod: params.paymentMethod || 'yookassa',
        customer: {
            name: params.customerName || lic.customer?.name || 'Организация WORK',
            inn: params.customerInn || lic.customer?.inn || '',
            kpp: params.customerKpp || '',
            legalAddress: params.customerLegalAddress || '',
            email: params.customerEmail || tokenBinding?.email || lic.customer?.email || '',
        },
        ofertaAccepted: params.ofertaAccepted !== false,
        returnUrl: params.returnUrl || '',
    };
    const res = await fetch(`${baseUrl}/api/orders/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Ошибка оформления заказа (${res.status}): ${text.slice(0, 200)}`);
    }
    return res.json();
}

/**
 * Методы `license_*` и `updater_*`, подключаемые к классам WORK и в шлюз `gateway.js`.
 */
export const LICENSE_METHODS = Object.freeze({
    license_status: {
        level: 'read',
        fn: async function () {
            return getFullLicenseStatus();
        },
    },
    license_quote: {
        level: 'read',
        fn: async function (p = {}) {
            const body = typeof p.post === 'object' && p.post ? { ...p, ...p.post } : p;
            return calculateLicenseQuote(body);
        },
    },
    license_bind_token: {
        level: 'admin',
        fn: async function (p = {}) {
            const body = typeof p.post === 'object' && p.post ? { ...p, ...p.post } : p;
            const token = String(body.token || '').trim();
            if (!token)
                throw new Error('Укажите токен владельца (owk1...), сгенерированный в личном кабинете work.odant.org');
            return bindOwnerTokenAndSync({ token });
        },
    },
    license_unbind_token: {
        level: 'admin',
        fn: async function () {
            return unbindOwnerToken();
        },
    },
    license_install: {
        level: 'admin',
        fn: async function (p = {}) {
            const body = typeof p.post === 'object' && p.post ? { ...p, ...p.post } : p;
            const raw = body.certificate ?? body.license ?? body;
            const cert = typeof raw === 'string' ? JSON.parse(raw) : raw;
            if (!cert || typeof cert !== 'object' || (!cert.licenseId && !cert.fileId))
                throw new Error('Некорректный формат файла или сертификата лицензии');

            // Если загружен отдельный файл лицензии (.lic.json: base или addon)
            if (cert.protocol === LICENSE_FILE_PROTOCOL || cert.kind === 'base' || cert.kind === 'addon') {
                if (!verifyLicenseFile(cert)) {
                    throw new Error('Подпись файла лицензии не принадлежит официальному центру сертификации ODANT');
                }
                saveLicenseFilesToSystem([cert], SYSTEM_DIR);
                return getFullLicenseStatus();
            }

            if (!verifyLicenseCertificate(cert)) {
                throw new Error('Подпись сертификата лицензии не принадлежит официальному центру сертификации ODANT');
            }
            const current = loadLocalLicense();
            const merged = {
                ...current,
                ...cert,
                unlicensed: false,
                baseActivated: true,
                customer: { ...current.customer, ...(cert.customer || {}) },
                support: { ...current.support, ...(cert.support || {}) },
            };
            saveLocalLicense(merged);
            return getFullLicenseStatus({ license: merged });
        },
    },
    license_sync: {
        level: 'admin',
        fn: async function (p = {}) {
            const body = typeof p.post === 'object' && p.post ? { ...p, ...p.post } : p;
            return syncWithLicenseHub({ hubUrl: body.hubUrl, token: body.token });
        },
    },
    license_checkout: {
        level: 'admin',
        fn: async function (p = {}) {
            const body = typeof p.post === 'object' && p.post ? { ...p, ...p.post } : p;
            return createHubCheckoutOrder(body);
        },
    },
    updater_status: {
        level: 'read',
        fn: async function () {
            ensurePackageManifest('.');
            return loadAutoUpdateState('.');
        },
    },
    updater_check: {
        level: 'admin',
        fn: async function (p = {}) {
            const body = typeof p.post === 'object' && p.post ? { ...p, ...p.post } : p;
            return checkForNpmUpdates({ registryUrl: body.registryUrl });
        },
    },
    updater_apply: {
        level: 'admin',
        fn: async function (p = {}) {
            const body = typeof p.post === 'object' && p.post ? { ...p, ...p.post } : p;
            return checkAndApplyNpmUpdate({ registryUrl: body.registryUrl, installDeps: true });
        },
    },
    updater_configure: {
        level: 'admin',
        fn: async function (p = {}) {
            const body = typeof p.post === 'object' && p.post ? { ...p, ...p.post } : p;
            const patch = {};
            if (body.enabled !== undefined) patch.enabled = Boolean(body.enabled);
            if (body.checkIntervalHours !== undefined) patch.checkIntervalHours = Math.max(1, Number(body.checkIntervalHours) || 6);
            if (body.registryUrl) patch.registryUrl = String(body.registryUrl).trim();
            return saveAutoUpdateState(patch, '.');
        },
    },
});
