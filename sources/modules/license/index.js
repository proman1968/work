/**
 * Клиентский модуль лицензирования ПАК WORK (sources/modules/license/index.js).
 *
 * Отвечает за:
 *  - паспорт программно-аппаратного комплекса (AMD Ryzen 495 8085, 192 ГБ RAM, SSD 4 ТБ)
 *    и реестр предустановленных моделей ИИ (Qwen 3 30B + Голосовая + Генерация изображений + Embedding);
 *  - хранение и криптографическую проверку сертификата лицензии Ed25519 (#system/license.json);
 *  - учёт рабочих мест: 5 вечных (базовый комплект ПАК) + срочные годовые лицензии (Start / Business / Enterprise);
 *  - контроль лимита одновременных пользовательских сессий при входе в WORK;
 *  - взаимодействие с лицензионным сервером https://work.odant.org (синхронизация, покупка через ЮKassa,
 *    привязка ботов поддержки MAX, Telegram, VK).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { serverKeys, fingerprint } from '../nodes/identity.js';
import { serverId } from '../../host/server-id.js';

export const LICENSE_PROTOCOL = 'WORK-LIC-v1';
export const DEFAULT_LICENSE_HUB_URL = process.env.WORK_LICENSE_HUB_URL || 'https://work.odant.org';
const LICENSE_FILE = './#system/license.json';

/** Эталонная спецификация базового ПАК WORK. */
export const PAK_HARDWARE_SPEC = Object.freeze({
    sku: 'WORK-PAK-495-192-4T',
    title: 'ПАК WORK AI-Server (Базовый комплект)',
    cpu: 'AMD Ryzen 495 8085',
    ramGb: 192,
    ssdTb: 4,
    basePriceRub: 5_000_000,
    baseSeats: 5,
    perpetualBase: true,
    includedSupportYears: 1,
    includedSupportTier: 'business',
    configuration: 'Типовая комплексная учётная конфигурация (аналог 1С: Предприятие — справочники, план счетов, двойная запись, ведомости, первичные документы, импорт 1С)',
    preinstalledModels: Object.freeze([
        {
            id: 'Qwen3-30B-A3B',
            category: 'llm',
            title: 'Qwen 3 30B',
            role: 'Основная языковая модель (диалог, ИИ-агент, учётные операции, аналитика, код)',
            path: '/MODELS/Local/Qwen3-30B-A3B',
            hfRepo: 'Qwen/Qwen3-30B-A3B',
            ramEstimateGb: 18.5,
        },
        {
            id: 'Qwen3-Voice',
            category: 'voice',
            title: 'Голосовая модель (ASR + TTS)',
            role: 'Полнодуплексный голосовой диалог с перебиванием, распознавание и синтез речи (Qwen3-ASR + Qwen3-TTS)',
            path: '/MODELS/Local/Qwen3-Voice',
            hfRepo: 'Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign',
            ramEstimateGb: 4.2,
        },
        {
            id: 'Flux-Image',
            category: 'image',
            title: 'Генерация изображений',
            role: 'Локальный синтез иллюстраций, карточек товаров, схем и визуальных материалов',
            path: '/MODELS/Local/Flux-Image',
            hfRepo: 'black-forest-labs/FLUX.1-schnell',
            ramEstimateGb: 12.0,
        },
        {
            id: 'Qwen3-Embedding',
            category: 'embedding',
            title: 'Embedding-модель (RAG)',
            role: 'Семантический векторный поиск по документам, договорам, проводкам и базе знаний',
            path: '/MODELS/Local/Qwen3-Embedding',
            hfRepo: 'Qwen/Qwen3-Embedding-4B',
            ramEstimateGb: 2.5,
        },
    ]),
});

/** Уровни годовой поддержки и стоимость дополнительной годовой лицензии на 1 пользователя. */
export const SUPPORT_TIERS = Object.freeze({
    start: Object.freeze({
        id: 'start',
        name: 'Start',
        pricePerUserYearRub: 15_000,
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
        pricePerUserYearRub: 40_000,
        ticketsPerSeatYear: 48,
        reactionMinutes: 120,
        reactionText: 'до 2 часов',
        scheduleText: '7 дней в неделю (08:00–22:00 МСК)',
        channels: ['MAX', 'Telegram', 'VK'],
        description: 'Бизнес-поддержка: до 48 обращений в год на место, время реакции до 2 часов, помощь по настройке учёта и локальных моделей.',
    }),
    enterprise: Object.freeze({
        id: 'enterprise',
        name: 'Enterprise',
        pricePerUserYearRub: 100_000,
        ticketsPerSeatYear: 9999,
        reactionMinutes: 15,
        reactionText: 'до 15 минут (24/7)',
        scheduleText: '24/7/365 (круглосуточно)',
        channels: ['MAX', 'Telegram', 'VK', 'Выделенный инженер'],
        description: 'Приоритетная поддержка 24/7: безлимитные обращения, реакция до 15 минут, персональный инженер и помощь в дообучении моделей (LoRA).',
    }),
});

/**
 * Каноническая сериализация тела лицензии для подписи и верификации Ed25519.
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
 * Проверить подпись Ed25519 сертификата лицензии.
 */
export function verifyLicenseCertificate(lic, trustedPublicKeyB64 = '') {
    if (!lic || typeof lic !== 'object' || !lic.signature)
        return false;
    const pubB64 = trustedPublicKeyB64 || process.env.WORK_LICENSE_PUBLIC_KEY || lic.issuerPublicKey;
    if (!pubB64)
        return false;
    try {
        const pub = crypto.createPublicKey({
            key: Buffer.from(String(pubB64), 'base64'),
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
 * Прочитать локальную лицензию из #system/license.json (или создать дефолтную вечную на 5 мест ПАК).
 */
export function loadLocalLicense(customPath = LICENSE_FILE) {
    try {
        if (fs.existsSync(customPath)) {
            const parsed = JSON.parse(fs.readFileSync(customPath, 'utf8'));
            if (parsed && typeof parsed === 'object')
                return parsed;
        }
    }
    catch { /* создаём базовую */ }

    const hw = getHardwareIdentity();
    const now = Date.now();
    const oneYearMs = 365 * 24 * 3600_000;
    const baseLic = {
        protocol: LICENSE_PROTOCOL,
        licenseId: 'PAK-BASE-' + hw.hwid.replace(/^PAK-/, ''),
        issuedAt: now,
        issuer: 'work.odant.org',
        customer: {
            name: 'Владелец ПАК WORK',
            inn: '',
            email: '',
        },
        hardware: {
            hwid: hw.hwid,
            nodeFingerprint: hw.nodeFingerprint,
            sku: PAK_HARDWARE_SPEC.sku,
            cpu: PAK_HARDWARE_SPEC.cpu,
            ramGb: PAK_HARDWARE_SPEC.ramGb,
            ssdTb: PAK_HARDWARE_SPEC.ssdTb,
        },
        baseSeats: PAK_HARDWARE_SPEC.baseSeats,
        perpetualBase: true,
        addonSubscriptions: [],
        support: {
            tier: PAK_HARDWARE_SPEC.includedSupportTier,
            includedUntil: now + oneYearMs,
            ticketsUsed: 0,
            bindCode: '',
        },
        hubUrl: DEFAULT_LICENSE_HUB_URL,
    };
    return baseLic;
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
 * Рассчитать действующие рабочие места и активный уровень поддержки на текущий момент.
 */
export function evaluateLicenseState(lic = loadLocalLicense(), now = Date.now()) {
    const baseSeats = Math.max(0, Number(lic.baseSeats ?? PAK_HARDWARE_SPEC.baseSeats));
    const subs = Array.isArray(lic.addonSubscriptions) ? lic.addonSubscriptions : [];
    const activeSubs = [];
    const expiredSubs = [];

    let addonSeats = 0;
    let highestTier = null;
    let totalTicketsQuota = 0;
    let nearestExpiry = null;

    const tierRank = { start: 1, business: 2, enterprise: 3 };
    const oneYearMs = 365 * 24 * 3600_000;
    const baseSupportUntil = Number(lic.support?.includedUntil || ((Number(lic.issuedAt) || now) + oneYearMs));
    const baseSupportActive = baseSupportUntil > now;

    if (baseSupportActive) {
        const baseTierKey = String(lic.support?.tier || PAK_HARDWARE_SPEC.includedSupportTier || 'business').toLowerCase();
        const baseTierSpec = SUPPORT_TIERS[baseTierKey] || SUPPORT_TIERS.business;
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
    if (totalTicketsQuota === 0) {
        totalTicketsQuota = baseSeats * SUPPORT_TIERS.start.ticketsPerSeatYear;
    }

    const hw = getHardwareIdentity();
    const hardwareMatch = (!lic.hardware?.hwid || lic.hardware.hwid === hw.hwid)
        && (!lic.hardware?.nodeFingerprint || lic.hardware.nodeFingerprint === hw.nodeFingerprint);
    const signed = !!lic.signature;
    const signatureValid = signed ? verifyLicenseCertificate(lic) : false;

    return {
        licenseId: lic.licenseId,
        issuer: lic.issuer || 'work.odant.org',
        issuedAt: lic.issuedAt || now,
        customer: lic.customer || {},
        hardware: lic.hardware || {},
        hardwareMatch,
        baseSeats,
        perpetualBase: lic.perpetualBase !== false,
        addonSeats,
        totalSeats: baseSeats + addonSeats,
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
 * Подсчитать одновременные активные пользовательские сессии (concurrent sessions в $server.sessions).
 * Каждая активная сессия с вошедшим пользователем (открытый WebSocket или HTTP-активность за последние 30 мин)
 * занимает 1 конкурентное рабочее место (по модели 1С).
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
 * Проверить доступность одновременной пользовательской сессии (рабочего места) перед входом.
 * Считается по одновременным активным сессиям (concurrent sessions):
 * - Если эта же сессия (currentSsid) уже авторизована или пользователь — глобальный ADMIN сервера — вход разрешён.
 * - Если число активных одновременных сессий достигло лимита (5 вечных + активные годовые места) — выбрасывает ошибку.
 */
export function assertWorkplaceAvailableForLogin(uid, { sessions, currentSsid = '', license, isAdmin = false } = {}) {
    if (!uid)
        return true;
    const licState = evaluateLicenseState(license || loadLocalLicense());
    const activeSessions = getActiveWorkplaces(sessions);
    if (currentSsid && activeSessions.some(s => s.ssid === currentSsid))
        return true;
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

/**
 * Полная сводка состояния ПАК и лицензии для UI и API.
 */
export function getFullLicenseStatus(options = {}) {
    const lic = options.license || loadLocalLicense(options.licensePath);
    const state = evaluateLicenseState(lic, options.now);
    const hardware = getHardwareIdentity();
    const activeUsers = getActiveWorkplaces(options.sessions);
    const models = inspectPreinstalledModels(options.rootDir || '.');

    return {
        ...state,
        activeSeatsCount: activeUsers.length,
        availableSeatsCount: Math.max(0, state.totalSeats - activeUsers.length),
        activeUsers,
        hardware,
        pakSpec: PAK_HARDWARE_SPEC,
        supportTiers: Object.values(SUPPORT_TIERS),
        preinstalledModels: models,
    };
}

/**
 * Калькулятор стоимости заказа (базовый ПАК + дополнительные годовые лицензии).
 */
export function calculateLicenseQuote({ includeBasePak = false, tier = 'business', addonSeats = 1, years = 1 } = {}) {
    const tierKey = String(tier || 'business').toLowerCase();
    const tierSpec = SUPPORT_TIERS[tierKey] || SUPPORT_TIERS.business;
    const seatsCount = Math.max(0, Math.floor(Number(addonSeats || 0)));
    const yearsCount = Math.max(1, Math.min(5, Math.floor(Number(years || 1))));
    const baseRub = includeBasePak ? PAK_HARDWARE_SPEC.basePriceRub : 0;
    const addonsRub = seatsCount * tierSpec.pricePerUserYearRub * yearsCount;
    return {
        includeBasePak: !!includeBasePak,
        basePakPriceRub: baseRub,
        baseSeatsIncluded: includeBasePak ? PAK_HARDWARE_SPEC.baseSeats : 0,
        tier: tierSpec.id,
        tierName: tierSpec.name,
        pricePerUserYearRub: tierSpec.pricePerUserYearRub,
        addonSeats: seatsCount,
        years: yearsCount,
        addonsTotalRub: addonsRub,
        totalRub: baseRub + addonsRub,
        reactionText: tierSpec.reactionText,
        ticketsPerYear: seatsCount * tierSpec.ticketsPerSeatYear,
    };
}

/**
 * Синхронизировать лицензию с сервером work.odant.org.
 */
export async function syncWithLicenseHub({ hubUrl, licensePath } = {}) {
    const lic = loadLocalLicense(licensePath);
    const hw = getHardwareIdentity();
    const baseUrl = String(hubUrl || lic.hubUrl || DEFAULT_LICENSE_HUB_URL).replace(/\/+$/, '');
    const res = await fetch(`${baseUrl}/api/license/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            licenseId: lic.licenseId,
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
    if (data?.certificate) {
        const updated = {
            ...lic,
            ...data.certificate,
            hubUrl: baseUrl,
        };
        saveLocalLicense(updated, licensePath);
        return getFullLicenseStatus({ license: updated });
    }
    return getFullLicenseStatus({ license: lic });
}

/**
 * Создать платёж ЮKassa на сервере work.odant.org для докупки годовых мест.
 */
export async function createHubCheckoutOrder(params = {}) {
    const lic = loadLocalLicense(params.licensePath);
    const hw = getHardwareIdentity();
    const baseUrl = String(params.hubUrl || lic.hubUrl || DEFAULT_LICENSE_HUB_URL).replace(/\/+$/, '');
    const payload = {
        licenseId: lic.licenseId,
        hwid: hw.hwid,
        nodeFingerprint: hw.nodeFingerprint,
        includeBasePak: !!params.includeBasePak,
        tier: params.tier || 'business',
        addonSeats: Math.max(1, Number(params.addonSeats || 1)),
        years: Math.max(1, Number(params.years || 1)),
        customer: {
            name: params.customerName || lic.customer?.name || 'Организация WORK',
            inn: params.customerInn || lic.customer?.inn || '',
            email: params.customerEmail || lic.customer?.email || '',
        },
        returnUrl: params.returnUrl || '',
    };
    const res = await fetch(`${baseUrl}/api/orders/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Ошибка создания счёта ЮKassa (${res.status}): ${text.slice(0, 200)}`);
    }
    return res.json();
}

/**
 * Методы `license_*`, подключаемые к классам WORK и в шлюз `gateway.js`.
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
    license_install: {
        level: 'admin',
        fn: async function (p = {}) {
            const body = typeof p.post === 'object' && p.post ? { ...p, ...p.post } : p;
            const raw = body.certificate ?? body.license ?? body;
            const cert = typeof raw === 'string' ? JSON.parse(raw) : raw;
            if (!cert || typeof cert !== 'object' || !cert.licenseId)
                throw new Error('Некорректный формат сертификата лицензии');
            if (cert.signature && (cert.issuerPublicKey || process.env.WORK_LICENSE_PUBLIC_KEY)) {
                if (!verifyLicenseCertificate(cert))
                    throw new Error('Подпись сертификата лицензии не прошла проверку');
            }
            const current = loadLocalLicense();
            const merged = {
                ...current,
                ...cert,
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
            return syncWithLicenseHub({ hubUrl: body.hubUrl });
        },
    },
    license_checkout: {
        level: 'admin',
        fn: async function (p = {}) {
            const body = typeof p.post === 'object' && p.post ? { ...p, ...p.post } : p;
            return createHubCheckoutOrder(body);
        },
    },
});
