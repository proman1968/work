/**
 * Хранилище лицензионного сервера work.odant.org:
 *  - Реестр выпущенных лицензий ПАК (вечные 5 мест + 1 год включённой поддержки + срочные годовые расширения);
 *  - Заказы и платежи ЮKassa;
 *  - Привязки клиентских чатов (MAX, Telegram, VK) по коду привязки или номеру лицензии;
 *  - Тикеты техподдержки с расчётом SLA времени реакции и лимитов обращений по уровням Start / Business / Enterprise.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
    PAK_PRODUCT,
    BASE_LICENSE_PRODUCT,
    ADDITIONAL_PRODUCTS,
    VENDOR_CONTACTS,
    SLA_TIERS,
    calculateOrderQuote,
    FRANCHISE_PROGRAM,
    REGIONS_CATALOG,
    PARTNER_TRAINING_TRACKS,
    calculateFranchiseFee,
    calculatePartnerDiscount,
    PUBLIC_OFERTA,
} from './catalog.js';
import {
    loadOrCreateAuthorityKeys,
    signCertificate,
    signLicenseFile,
    createOwnerAccessToken,
    parseOwnerAccessToken,
    verifyOwnerAccessToken,
    createSessionToken,
    verifySessionToken,
} from './crypto.js';

const ONE_YEAR_MS = 365 * 24 * 3600_000;
export const FRANCHISE_RESERVATION_TTL_MS = 15 * 60 * 1000; // 15 минут на оплату начального взноса за резерв франшизы

/**
 * Построить 12-месячный график погашения остатка паушального взноса за региональную франшизу (платёж раз в месяц в течение года).
 */
export function buildFranchisePaymentSchedule({
    remainingRub = 0,
    startMs = Date.now(),
    existingSchedule = [],
} = {}) {
    const totalRub = Math.max(0, Math.round(Number(remainingRub || 0)));
    const months = 12;
    const baseMonthly = Math.floor(totalRub / months);
    const schedule = [];
    for (let m = 1; m <= months; m++) {
        const prev = Array.isArray(existingSchedule)
            ? existingSchedule.find(x => Number(x.monthNumber) === m)
            : null;
        const amountRub = (m < months) ? baseMonthly : Math.max(0, totalRub - baseMonthly * (months - 1));
        const d = new Date(Number(startMs || Date.now()));
        d.setMonth(d.getMonth() + m);
        schedule.push({
            monthNumber: m,
            installmentId: prev?.installmentId || `INST-${String(m).padStart(2, '0')}`,
            title: `Платёж №${m} (месяц ${m} из ${months})`,
            dueDate: prev?.status === 'paid' && prev?.dueDate ? prev.dueDate : d.getTime(),
            amountRub: prev?.status === 'paid' && prev?.amountRub ? prev.amountRub : amountRub,
            status: prev?.status === 'paid' ? 'paid' : 'pending',
            paidAt: prev?.paidAt || null,
            orderId: prev?.orderId || '',
            paymentId: prev?.paymentId || '',
        });
    }
    return schedule;
}

/**
 * Проверить, указывает ли путь внутрь временного кэша npx / npm или папки node_modules.
 * Хранить базу данных внутри таких папок недопустимо, так как при обновлении версии npx создаёт новый хэш-каталог.
 */
export function isEphemeralPackagePath(dirPath = '') {
    const norm = String(dirPath || '').replace(/\\/g, '/').toLowerCase();
    return norm.includes('/_npx/') || norm.includes('/node_modules/') || norm.includes('/npm-cache/');
}

/**
 * Проверить, является ли директория изолированной временной папкой автотестов.
 */
export function isTestTempPath(dirPath = '') {
    const full = path.resolve(String(dirPath || ''));
    const norm = full.replace(/\\/g, '/').toLowerCase();
    const tmpNorm = os.tmpdir().replace(/\\/g, '/').toLowerCase();
    if (tmpNorm && norm.startsWith(tmpNorm))
        return true;
    return norm.includes('fake-hub-data')
        || norm.includes('work-lic-')
        || norm.includes('work-npx-test')
        || norm.includes('/temp/opencode/');
}

/**
 * Постоянное зеркало базы данных в профиле пользователя ОС (~/.odant-work-license/data).
 */
export function getHomeMirrorDataDir() {
    if (process.env.WORK_LICENSE_HOME_MIRROR)
        return path.resolve(process.env.WORK_LICENSE_HOME_MIRROR);
    return path.join(os.homedir(), '.odant-work-license', 'data');
}

/**
 * Определить постоянную папку хранения базы данных лицензионного сервера:
 *  1) Явная переменная окружения WORK_LICENSE_DATA_DIR;
 *  2) Явно переданный requestedDir (если он не указывает внутрь временного кэша _npx / node_modules);
 *  3) Постоянная папка внутри рабочей директории запуска (например, <WORK>/data или <WORK>/license-server/data);
 *  4) Защищённое системное хранилище в домашнем профиле ОС (~/.odant-work-license/data).
 */
export function resolvePersistentDataDir({
    requestedDir = '',
    cwd = process.cwd(),
    env = process.env,
} = {}) {
    if (env?.WORK_LICENSE_DATA_DIR && String(env.WORK_LICENSE_DATA_DIR).trim()) {
        return path.resolve(String(env.WORK_LICENSE_DATA_DIR).trim());
    }
    if (requestedDir && requestedDir !== './data' && !isEphemeralPackagePath(requestedDir)) {
        return path.resolve(requestedDir);
    }
    const cleanCwd = path.resolve(cwd || process.cwd());
    if (!isEphemeralPackagePath(cleanCwd)) {
        const lsData = path.join(cleanCwd, 'license-server', 'data');
        if (fs.existsSync(path.join(lsData, 'store.json')))
            return lsData;
        const sysData = path.join(cleanCwd, '#system', 'license-server');
        if (fs.existsSync(path.join(sysData, 'store.json')))
            return sysData;
        return path.join(cleanCwd, 'data');
    }
    return getHomeMirrorDataDir();
}

/**
 * Найти все возможные папки на диске (включая старые хэш-каталоги ~/.npm/_npx/* и %LOCALAPPDATA%/npm-cache/_npx/*),
 * где могли остаться данные от предыдущих запусков через npx.
 */
export function findCandidateRecoveryDirs({
    primaryDir = '',
    cwd = process.cwd(),
    extraSearchRoots = [],
    includeSystemDefaults = true,
} = {}) {
    const seen = new Set();
    const dirs = [];
    const addDir = (d) => {
        if (!d) return;
        try {
            const full = path.resolve(d);
            const key = process.platform === 'win32' ? full.toLowerCase() : full;
            if (seen.has(key)) return;
            seen.add(key);
            if (fs.existsSync(full))
                dirs.push(full);
        }
        catch { /* ignore */ }
    };

    addDir(primaryDir);
    addDir(getHomeMirrorDataDir());

    const npxRoots = new Set();
    const addNpxRoot = (r) => {
        if (!r) return;
        try {
            const full = path.resolve(r);
            if (fs.existsSync(full))
                npxRoots.add(full);
        }
        catch { /* ignore */ }
    };

    for (const root of (extraSearchRoots || [])) {
        addDir(root);
        addNpxRoot(root);
        addNpxRoot(path.join(root, '_npx'));
    }

    if (includeSystemDefaults) {
        const cleanCwd = path.resolve(cwd || process.cwd());
        if (!isEphemeralPackagePath(cleanCwd)) {
            addDir(path.join(cleanCwd, 'data'));
            addDir(path.join(cleanCwd, '#system', 'license-server'));
            addDir(path.join(cleanCwd, 'license-server', 'data'));
        }

        try {
            addDir(fileURLToPath(new URL('../data', import.meta.url)));
        }
        catch { /* ignore */ }

        if (process.env.npm_config_cache)
            addNpxRoot(path.join(process.env.npm_config_cache, '_npx'));
        addNpxRoot(path.join(os.homedir(), '.npm', '_npx'));
        addNpxRoot(path.join(os.homedir(), '.npm-cache', '_npx'));
        addNpxRoot('/root/.npm/_npx');

        if (process.platform !== 'win32' && fs.existsSync('/home')) {
            try {
                for (const entry of fs.readdirSync('/home', { withFileTypes: true })) {
                    if (entry.isDirectory()) {
                        addNpxRoot(path.join('/home', entry.name, '.npm', '_npx'));
                        addDir(path.join('/home', entry.name, '.odant-work-license', 'data'));
                    }
                }
            }
            catch { /* ignore */ }
        }

        if (process.env.LOCALAPPDATA)
            addNpxRoot(path.join(process.env.LOCALAPPDATA, 'npm-cache', '_npx'));
        if (process.env.APPDATA) {
            addNpxRoot(path.join(process.env.APPDATA, 'npm-cache', '_npx'));
            addDir(path.join(process.env.APPDATA, 'npm', 'node_modules', 'work-license-server', 'data'));
        }
        addNpxRoot(path.join(os.homedir(), 'AppData', 'Local', 'npm-cache', '_npx'));
        addNpxRoot(path.join(os.homedir(), 'AppData', 'Roaming', 'npm-cache', '_npx'));

        addDir('/usr/local/lib/node_modules/work-license-server/data');
        addDir('/usr/lib/node_modules/work-license-server/data');
    }

    for (const npxRoot of npxRoots) {
        try {
            const entries = fs.readdirSync(npxRoot, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isDirectory()) continue;
                const hashDir = path.join(npxRoot, entry.name);
                addDir(path.join(hashDir, 'node_modules', 'work-license-server', 'data'));
                addDir(path.join(hashDir, 'node_modules', 'odant-work', 'license-server', 'data'));
                addDir(path.join(hashDir, 'node_modules', 'odant-work', 'data'));
            }
        }
        catch { /* ignore */ }
    }

    return dirs;
}

function isAutoPlaceholderLicense(lic, allOrders = {}) {
    if (!lic || typeof lic !== 'object') return false;
    if (lic.baseActivated) return false;
    if (lic.hardware?.hwidBound || lic.hardware?.nodeFingerprint) return false;
    if (Array.isArray(lic.addonSubscriptions) && lic.addonSubscriptions.length > 0) return false;
    if (Array.isArray(lic.paidOrderIds) && lic.paidOrderIds.length > 0) return false;
    const name = String(lic.serverName || '').trim();
    if (name && name !== 'Сервер WORK #1' && name !== 'Сервер WORK') return false;
    const hasOrders = Object.values(allOrders || {}).some(o => o && o.licenseId === lic.licenseId && o.status !== 'canceled');
    return !hasOrders;
}

export function maskSecret(value = '') {
    const s = String(value || '').trim();
    if (!s) return '';
    if (s.length >= 10)
        return `${s.slice(0, 6)}•••••••${s.slice(-4)}`;
    return '•••••••';
}

export function isMaskedSecret(value = '') {
    return String(value || '').includes('•••');
}

export function createDefaultPortalSettings() {
    return {
        smtp: {
            host: process.env.SMTP_HOST || 'smtp.yandex.ru',
            port: Number(process.env.SMTP_PORT || 465),
            secure: process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) === 465 : true,
            user: process.env.SMTP_USER || 'proman1968.perepelkin@yandex.ru',
            pass: process.env.SMTP_PASS || 'zifeomdqijldyece',
            fromEmail: process.env.SMTP_FROM || process.env.SMTP_USER || 'proman1968.perepelkin@yandex.ru',
            senderName: process.env.SMTP_SENDER_NAME || 'ODANT-WORK',
        },
        yookassa: {
            shopId: process.env.YOOKASSA_SHOP_ID || '',
            secretKey: process.env.YOOKASSA_SECRET_KEY || '',
            sendReceipt: true,
        },
        bots: {
            telegramToken: process.env.TELEGRAM_BOT_TOKEN || '',
            telegramUsername: process.env.TELEGRAM_BOT_USERNAME || '',
            maxToken: process.env.MAX_BOT_TOKEN || '',
            maxUsername: process.env.MAX_BOT_USERNAME || '',
        },
        legal: {
            companyName: 'ООО «БИС» («Бизнес Интер Софт»)',
            authorName: 'Перепелкин Роман Александрович',
            legalStatus: 'Правообладатель и Оператор платформы · Проприетарное ПО (Все права защищены)',
            inn: '6234049193',
            ogrn: '',
            supportEmail: 'support@odant.org',
            phone: '+7 (4912) 77-70-21',
            address: VENDOR_CONTACTS.address || '390000, г. Рязань, ул. Ленина, 47',
        },
    };
}

/**
 * Безопасное объединение (merge без потери записей) двух состояний store.json.
 * Сохраняет всех пользователей, их реквизиты, токены привязки (owk1...), серверы/лицензии,
 * заказы, франшизы, партнёров, тикеты и привязки ботов.
 */
export function mergeStoreStates(baseState = {}, incomingState = {}) {
    const defSettings = createDefaultPortalSettings();
    const baseSet = baseState.settings || {};
    const incSet = incomingState.settings || {};
    const out = {
        licenses: { ...(baseState.licenses || {}) },
        orders: { ...(baseState.orders || {}) },
        tickets: { ...(baseState.tickets || {}) },
        botBindings: { ...(baseState.botBindings || {}) },
        partners: { ...(baseState.partners || {}) },
        reservations: { ...(baseState.reservations || {}) },
        certificates: { ...(baseState.certificates || {}) },
        users: { ...(baseState.users || {}) },
        settings: {
            smtp: { ...defSettings.smtp, ...(baseSet.smtp || {}), ...(incSet.smtp || {}) },
            yookassa: { ...defSettings.yookassa, ...(baseSet.yookassa || {}), ...(incSet.yookassa || {}) },
            bots: { ...defSettings.bots, ...(baseSet.bots || {}), ...(incSet.bots || {}) },
            legal: { ...defSettings.legal, ...(baseSet.legal || {}), ...(incSet.legal || {}) },
        },
    };

    // 1. Заказы (предпочитаем оплаченные или более свежие)
    for (const [orderId, incOrd] of Object.entries(incomingState.orders || {})) {
        if (!incOrd || !orderId) continue;
        const curOrd = out.orders[orderId];
        if (!curOrd) {
            out.orders[orderId] = structuredClone(incOrd);
            continue;
        }
        if (incOrd.status === 'paid' && curOrd.status !== 'paid') {
            out.orders[orderId] = { ...curOrd, ...structuredClone(incOrd) };
        }
        else if (curOrd.status === 'paid' && incOrd.status !== 'paid') {
            out.orders[orderId] = { ...structuredClone(incOrd), ...curOrd };
        }
        else {
            const incTs = Number(incOrd.paidAt || incOrd.updatedAt || incOrd.createdAt || 0);
            const curTs = Number(curOrd.paidAt || curOrd.updatedAt || curOrd.createdAt || 0);
            out.orders[orderId] = incTs >= curTs
                ? { ...curOrd, ...structuredClone(incOrd) }
                : { ...structuredClone(incOrd), ...curOrd };
        }
    }

    // 2. Серверы / Лицензии
    for (const [licId, incLic] of Object.entries(incomingState.licenses || {})) {
        if (!incLic || !licId) continue;
        const curLic = out.licenses[licId];
        if (!curLic) {
            out.licenses[licId] = structuredClone(incLic);
            continue;
        }
        const incTs = Number(incLic.updatedAt || incLic.issuedAt || 0);
        const curTs = Number(curLic.updatedAt || curLic.issuedAt || 0);
        const [older, newer] = incTs >= curTs ? [curLic, incLic] : [incLic, curLic];

        const mergedAddonsMap = new Map();
        for (const sub of [...(older.addonSubscriptions || []), ...(newer.addonSubscriptions || [])]) {
            if (!sub) continue;
            const key = sub.id || sub.orderId || JSON.stringify(sub);
            mergedAddonsMap.set(key, sub);
        }
        const mergedPaidOrders = Array.from(new Set([
            ...(older.paidOrderIds || []),
            ...(newer.paidOrderIds || []),
        ]));

        const mergedCustomer = { ...(older.customer || {}), ...(newer.customer || {}) };
        for (const k of ['name', 'inn', 'kpp', 'legalAddress', 'email', 'phone']) {
            const vNew = String(newer.customer?.[k] || '').trim();
            const vOld = String(older.customer?.[k] || '').trim();
            mergedCustomer[k] = vNew || vOld;
        }

        const mergedHardware = (newer.hardware?.hwidBound || !older.hardware?.hwidBound)
            ? { ...(older.hardware || {}), ...(newer.hardware || {}) }
            : { ...(newer.hardware || {}), ...(older.hardware || {}) };

        const pickServerName = (newer.serverName && newer.serverName !== 'Сервер WORK #1' && newer.serverName !== 'Сервер WORK')
            ? newer.serverName
            : (older.serverName || newer.serverName || 'Сервер WORK #1');

        out.licenses[licId] = {
            ...older,
            ...newer,
            serverName: pickServerName,
            baseActivated: Boolean(older.baseActivated || newer.baseActivated),
            perpetualBase: Boolean(older.perpetualBase || newer.perpetualBase || older.baseActivated || newer.baseActivated),
            baseSeats: Math.max(Number(older.baseSeats || 0), Number(newer.baseSeats || 0), PAK_PRODUCT.baseSeats),
            issuedAt: Math.min(Number(older.issuedAt || Date.now()), Number(newer.issuedAt || Date.now())),
            updatedAt: Math.max(incTs, curTs),
            hubToken: older.hubToken || newer.hubToken || '',
            hubTokenId: older.hubTokenId || newer.hubTokenId || '',
            hubTokenSecret: older.hubTokenSecret || newer.hubTokenSecret || '',
            customer: mergedCustomer,
            hardware: mergedHardware,
            addonSubscriptions: Array.from(mergedAddonsMap.values()),
            paidOrderIds: mergedPaidOrders,
        };
    }

    // 3. Пользователи Личного кабинета и администраторы
    for (const [rawKey, incUser] of Object.entries(incomingState.users || {})) {
        if (!incUser || typeof incUser !== 'object') continue;
        const email = String(incUser.email || rawKey || '').trim().toLowerCase();
        if (!email) continue;
        const curUser = out.users[email];
        if (!curUser) {
            out.users[email] = { ...structuredClone(incUser), email };
            continue;
        }

        const emailPrefix = email.split('@')[0];
        const isRealName = (val) => {
            const s = String(val || '').trim();
            return Boolean(s && s.toLowerCase() !== emailPrefix && s !== 'Организация ODANT-WORK' && !s.includes('@'));
        };

        const curCreated = Number(curUser.createdAt || Date.now());
        const incCreated = Number(incUser.createdAt || Date.now());
        const [olderU, newerU] = incCreated >= curCreated ? [curUser, incUser] : [incUser, curUser];

        const mergedUser = {
            ...olderU,
            ...newerU,
            userId: olderU.userId || newerU.userId,
            email,
            isAdmin: Boolean(curUser.isAdmin || incUser.isAdmin),
            role: (curUser.isAdmin || incUser.isAdmin) ? 'ADMIN' : 'CLIENT',
            createdAt: Math.min(curCreated, incCreated),
            lastLoginAt: Math.max(Number(curUser.lastLoginAt || 0), Number(incUser.lastLoginAt || 0)),
            name: isRealName(newerU.name) ? newerU.name : (isRealName(olderU.name) ? olderU.name : (newerU.name || olderU.name || emailPrefix)),
            companyName: isRealName(newerU.companyName) ? newerU.companyName : (isRealName(olderU.companyName) ? olderU.companyName : (newerU.companyName || olderU.companyName || '')),
            hubToken: olderU.hubToken || newerU.hubToken || '',
            hubTokenId: olderU.hubTokenId || newerU.hubTokenId || '',
            hubTokenSecret: olderU.hubTokenSecret || newerU.hubTokenSecret || '',
            hubUrl: newerU.hubUrl || olderU.hubUrl || 'https://work.odant.org',
            sessionKey: newerU.sessionKey || olderU.sessionKey || '',
            ofertaAccepted: Boolean(curUser.ofertaAccepted || incUser.ofertaAccepted),
            ofertaAcceptedAt: olderU.ofertaAcceptedAt || newerU.ofertaAcceptedAt || null,
            ofertaVersion: newerU.ofertaVersion || olderU.ofertaVersion || '',
            ofertaSignerName: isRealName(newerU.ofertaSignerName) ? newerU.ofertaSignerName : (olderU.ofertaSignerName || newerU.ofertaSignerName || ''),
            ofertaSignatureId: olderU.ofertaSignatureId || newerU.ofertaSignatureId || '',
        };

        for (const field of ['position', 'inn', 'kpp', 'legalAddress', 'signerName', 'signerPosition', 'bankName', 'bik', 'bankAccount', 'corrAccount', 'phone']) {
            const vNew = String(newerU[field] || '').trim();
            const vOld = String(olderU[field] || '').trim();
            mergedUser[field] = vNew || vOld;
        }

        out.users[email] = mergedUser;
    }

    // 4. Очистка пустых дублей «Сервер WORK #1», автоматически созданных при входе в пустую БД после перезапуска npx
    for (const user of Object.values(out.users)) {
        if (!user) continue;
        const uEmail = String(user.email || '').toLowerCase();
        const userLics = Object.values(out.licenses).filter(l => l && (
            (user.userId && l.ownerAccountId === user.userId)
            || (uEmail && String(l.ownerEmail || l.customer?.email || '').toLowerCase() === uEmail)
        )).sort((a, b) => (a.issuedAt || 0) - (b.issuedAt || 0));

        if (userLics.length > 1) {
            const nonPlaceholders = userLics.filter(l => !isAutoPlaceholderLicense(l, out.orders));
            const keepList = nonPlaceholders.length > 0 ? nonPlaceholders : [userLics[0]];
            const keepIds = new Set(keepList.map(l => l.licenseId));
            for (const l of userLics) {
                if (!keepIds.has(l.licenseId) && isAutoPlaceholderLicense(l, out.orders)) {
                    delete out.licenses[l.licenseId];
                }
            }
            const remaining = userLics.filter(l => out.licenses[l.licenseId]);
            if (remaining.length > 0 && (!user.licenseId || !out.licenses[user.licenseId])) {
                const best = remaining.find(l => l.baseActivated || l.hardware?.hwidBound) || remaining[0];
                user.licenseId = best.licenseId;
            }
        }
        else if (userLics.length === 1) {
            user.licenseId = userLics[0].licenseId;
        }
    }

    // 5. Резервы франшиз и 12-месячные графики платежей
    for (const [resId, incRes] of Object.entries(incomingState.reservations || {})) {
        if (!incRes || !resId) continue;
        const curRes = out.reservations[resId];
        if (!curRes) {
            out.reservations[resId] = structuredClone(incRes);
            continue;
        }
        const mergedSchedule = buildFranchisePaymentSchedule({
            remainingRub: incRes.remainingFranchiseFeeRub ?? curRes.remainingFranchiseFeeRub ?? 0,
            startMs: Math.min(Number(curRes.createdAt || Date.now()), Number(incRes.createdAt || Date.now())),
            existingSchedule: (curRes.paymentSchedule || []).map((item, idx) => {
                const incItem = (incRes.paymentSchedule || [])[idx];
                if (incItem?.status === 'paid' && item.status !== 'paid') return incItem;
                return item;
            }),
        });
        out.reservations[resId] = {
            ...curRes,
            ...incRes,
            depositPaid: Boolean(curRes.depositPaid || incRes.depositPaid),
            paidInstallmentsRub: Math.max(Number(curRes.paidInstallmentsRub || 0), Number(incRes.paidInstallmentsRub || 0)),
            totalPaidRub: Math.max(Number(curRes.totalPaidRub || 0), Number(incRes.totalPaidRub || 0)),
            paymentSchedule: mergedSchedule,
        };
    }

    // 6. Партнёры, тикеты, привязки ботов и сертификаты специалистов
    for (const [pId, incP] of Object.entries(incomingState.partners || {})) {
        if (!incP || !pId) continue;
        const curP = out.partners[pId];
        if (!curP) {
            out.partners[pId] = structuredClone(incP);
            continue;
        }
        const issuedLicenses = Array.from(new Set([...(curP.issuedLicenses || []), ...(incP.issuedLicenses || [])]));
        const certMap = new Map();
        for (const c of [...(curP.certifiedSpecialists || []), ...(incP.certifiedSpecialists || [])]) {
            if (c) certMap.set(c.certificateId || `${c.email}:${c.trackId}`, c);
        }
        out.partners[pId] = {
            ...curP,
            ...incP,
            annualSalesRub: Math.max(Number(curP.annualSalesRub || 0), Number(incP.annualSalesRub || 0)),
            issuedLicenses,
            certifiedSpecialists: Array.from(certMap.values()),
        };
    }

    for (const [tId, incT] of Object.entries(incomingState.tickets || {})) {
        if (!incT || !tId) continue;
        const curT = out.tickets[tId];
        if (!curT) {
            out.tickets[tId] = structuredClone(incT);
            continue;
        }
        const msgMap = new Map();
        for (const m of [...(curT.messages || []), ...(incT.messages || [])]) {
            if (m) msgMap.set(`${m.time}:${m.author}:${m.text}`, m);
        }
        out.tickets[tId] = {
            ...curT,
            ...incT,
            messages: Array.from(msgMap.values()).sort((a, b) => (a.time || 0) - (b.time || 0)),
        };
    }

    Object.assign(out.botBindings, incomingState.botBindings || {});
    Object.assign(out.certificates, incomingState.certificates || {});

    return out;
}

export class LicenseStore {
    constructor({
        dataDir = '',
        adminLogin = '',
        adminPassword = '',
        publicOrigin = 'https://work.odant.org',
        autoRecover = undefined,
        extraSearchRoots = [],
    } = {}) {
        const isExplicitDir = Boolean(
            dataDir && dataDir !== './data' && (autoRecover === false || !isEphemeralPackagePath(dataDir))
        );
        this.dataDir = isExplicitDir
            ? path.resolve(dataDir)
            : resolvePersistentDataDir({ requestedDir: dataDir });
        this.autoRecover = autoRecover !== undefined
            ? Boolean(autoRecover)
            : !isTestTempPath(this.dataDir);
        this.extraSearchRoots = Array.isArray(extraSearchRoots) ? extraSearchRoots : [];

        fs.mkdirSync(this.dataDir, { recursive: true });
        this.backupDir = path.join(this.dataDir, 'backups');
        this.stateFile = path.join(this.dataDir, 'store.json');
        this.prevStateFile = path.join(this.dataDir, 'store.prev.json');
        this.keyFile = path.join(this.dataDir, 'authority-key.json');
        this.mailFile = path.join(this.dataDir, 'mail.json');

        // Если в новой постоянной папке ещё нет authority-key.json, восстанавливаем его из прежних папок / кэша npx
        if (this.autoRecover && !fs.existsSync(this.keyFile)) {
            this._recoverAuthorityKeyFromCandidates();
        }

        const isOfficialOrigin = !publicOrigin || String(publicOrigin).includes('work.odant.org') || String(publicOrigin).includes('localhost');
        const isFakeTestDir = String(this.dataDir).includes('fake-hub-data');
        this.authorityKeys = loadOrCreateAuthorityKeys(this.keyFile, {
            useCanonicalFallback: isOfficialOrigin && !isFakeTestDir,
        });
        this.adminLogin = String(adminLogin || process.env.WORK_ADMIN_LOGIN || 'admin').trim();
        this.adminPassword = String(adminPassword || process.env.WORK_ADMIN_PASSWORD || process.env.WORK_ADMIN_KEY || 'odant-admin');
        this.adminSessions = new Map();
        this.revokedSessions = new Set();
        this._readFailedGuard = false;

        this.state = {
            licenses: {},
            orders: {},
            tickets: {},
            botBindings: {},
            partners: {},
            reservations: {},
            certificates: {},
            users: {},
            settings: createDefaultPortalSettings(),
        };
        this._load();
        this._loadOrSyncMailFile();
    }

    /**
     * Авторизация администратора центра лицензирования (/admin).
     */
    loginAdmin({ login = 'admin', password = '' } = {}) {
        const cleanLogin = String(login || 'admin').trim();
        const cleanPass = String(password || '');
        if (cleanLogin !== this.adminLogin || cleanPass !== this.adminPassword) {
            throw new Error('Неверный логин или ключ администратора');
        }
        const token = 'adm_' + crypto.randomBytes(24).toString('hex');
        const now = Date.now();
        const session = {
            token,
            login: cleanLogin,
            createdAt: now,
            expiresAt: now + 7 * 24 * 3600_000,
        };
        this.adminSessions.set(token, session);
        return {
            authenticated: true,
            login: cleanLogin,
            token,
            expiresAt: session.expiresAt,
        };
    }

    logoutAdmin(token = '') {
        const clean = String(token || '').trim();
        if (clean) {
            this.adminSessions.delete(clean);
            this.revokedSessions.add(clean);
        }
        return { ok: true };
    }

    verifyAdminToken(token = '') {
        return Boolean(this.getAdminIdentity(token)?.authenticated);
    }

    getAdminIdentity(token = '') {
        const clean = String(token || '').trim();
        if (!clean || this.revokedSessions.has(clean))
            return null;
        const userFromTok = this._findUser(clean);
        if (userFromTok && userFromTok.isAdmin) {
            return {
                authenticated: true,
                login: userFromTok.email,
                email: userFromTok.email,
                userId: userFromTok.userId,
                role: 'ADMIN',
            };
        }
        if (clean === this.adminPassword && this.adminPassword.length >= 6) {
            return {
                authenticated: true,
                login: this.adminLogin,
                role: 'ADMIN',
            };
        }
        const sess = this.adminSessions.get(clean);
        if (!sess)
            return null;
        if (sess.expiresAt < Date.now()) {
            this.adminSessions.delete(clean);
            return null;
        }
        return {
            authenticated: true,
            login: sess.login || this.adminLogin,
            role: 'ADMIN',
        };
    }

    /**
     * Гарантировать, что первый зарегистрированный на сервере пользователь является администратором портала.
     */
    _ensureBootstrapAdmin() {
        const allUsers = Object.values(this.state.users || {});
        if (!allUsers.length)
            return null;
        const existingAdmin = allUsers.find(u => u.isAdmin);
        if (existingAdmin) {
            existingAdmin.role = 'ADMIN';
            return existingAdmin;
        }
        const firstUser = [...allUsers].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))[0];
        if (firstUser) {
            firstUser.isAdmin = true;
            firstUser.role = 'ADMIN';
        }
        return firstUser || null;
    }

    /**
     * Назначить или снять права администратора у пользователя по Email или userId.
     */
    setUserAdminRole(emailOrUserId = '', isAdmin = true) {
        const key = String(emailOrUserId || '').trim();
        let user = Object.values(this.state.users || {}).find(
            u => u.userId === key || String(u.email || '').toLowerCase() === key.toLowerCase()
        );
        if (!user && key.includes('@')) {
            this.registerOrLoginUser({ email: key.toLowerCase() });
            user = this.state.users[key.toLowerCase()] || null;
        }
        if (!user)
            throw new Error('Пользователь не найден');
        const nextAdmin = Boolean(isAdmin);
        if (!nextAdmin && user.isAdmin) {
            const otherAdmins = Object.values(this.state.users || {}).filter(u => u.isAdmin && u.userId !== user.userId);
            if (!otherAdmins.length) {
                throw new Error('Нельзя снять права у единственного администратора сервера');
            }
        }
        user.isAdmin = nextAdmin;
        user.role = nextAdmin ? 'ADMIN' : 'CLIENT';
        this._save();
        return this._formatUserResponse(user);
    }

    _ensureSettingsObject() {
        const def = createDefaultPortalSettings();
        if (!this.state.settings || typeof this.state.settings !== 'object') {
            this.state.settings = def;
        }
        this.state.settings.smtp = { ...def.smtp, ...(this.state.settings.smtp || {}) };
        this.state.settings.yookassa = { ...def.yookassa, ...(this.state.settings.yookassa || {}) };
        this.state.settings.bots = { ...def.bots, ...(this.state.settings.bots || {}) };
        this.state.settings.legal = { ...def.legal, ...(this.state.settings.legal || {}) };
        return this.state.settings;
    }

    _loadOrSyncMailFile() {
        const s = this._ensureSettingsObject();
        try {
            if (fs.existsSync(this.mailFile)) {
                const j = JSON.parse(fs.readFileSync(this.mailFile, 'utf8'));
                if (j?.host) s.smtp.host = String(j.host).trim();
                if (j?.port) s.smtp.port = Number(j.port);
                if (typeof j?.secure === 'boolean') s.smtp.secure = j.secure;
                if (j?.auth?.user || j?.user) s.smtp.user = String(j.auth?.user || j.user).trim();
                if (j?.auth?.pass || j?.pass) s.smtp.pass = String(j.auth?.pass || j.pass);
                if (j?.fromEmail) s.smtp.fromEmail = String(j.fromEmail).trim();
                if (j?.senderName) s.smtp.senderName = String(j.senderName).trim();
            }
            else {
                this._writeMailFile();
            }
        }
        catch { /* ignore */ }
    }

    _writeMailFile() {
        try {
            const smtp = this._ensureSettingsObject().smtp;
            const payload = {
                host: smtp.host,
                port: Number(smtp.port || 465),
                secure: Boolean(smtp.secure),
                fromEmail: smtp.fromEmail || smtp.user,
                senderName: smtp.senderName || 'ODANT-WORK',
                auth: {
                    user: smtp.user,
                    pass: smtp.pass,
                },
            };
            fs.writeFileSync(this.mailFile, JSON.stringify(payload, null, 2), 'utf8');
        }
        catch { /* ignore */ }
    }

    getSmtpConfig() {
        const smtp = this._ensureSettingsObject().smtp;
        return {
            host: String(smtp.host || 'smtp.yandex.ru').trim(),
            port: Number(smtp.port || 465),
            secure: smtp.secure !== undefined ? Boolean(smtp.secure) : Number(smtp.port || 465) === 465,
            user: String(smtp.user || '').trim(),
            pass: String(smtp.pass || ''),
            fromEmail: String(smtp.fromEmail || smtp.user || '').trim(),
            senderName: String(smtp.senderName || 'ODANT-WORK').trim(),
            mailFile: this.mailFile,
        };
    }

    getLegalSettings() {
        return { ...this._ensureSettingsObject().legal };
    }

    getAdminSettingsSummary() {
        const s = this._ensureSettingsObject();
        const smtpConnected = Boolean(s.smtp.host && s.smtp.user && s.smtp.pass);
        const yookassaLive = Boolean(s.yookassa.shopId && s.yookassa.secretKey);
        return {
            smtp: {
                host: s.smtp.host || '',
                port: Number(s.smtp.port || 465),
                secure: Boolean(s.smtp.secure),
                user: s.smtp.user || '',
                pass: maskSecret(s.smtp.pass),
                fromEmail: s.smtp.fromEmail || s.smtp.user || '',
                senderName: s.smtp.senderName || 'ODANT-WORK',
                connected: smtpConnected,
                mailFile: this.mailFile,
            },
            yookassa: {
                shopId: s.yookassa.shopId || '',
                secretKey: maskSecret(s.yookassa.secretKey),
                sendReceipt: Boolean(s.yookassa.sendReceipt),
                live: yookassaLive,
            },
            bots: {
                telegramToken: maskSecret(s.bots.telegramToken),
                telegramUsername: String(s.bots.telegramUsername || '').replace(/^@+/, ''),
                maxToken: maskSecret(s.bots.maxToken),
                maxUsername: String(s.bots.maxUsername || '').replace(/^@+/, ''),
            },
            legal: {
                companyName: s.legal.companyName || '',
                authorName: s.legal.authorName || '',
                legalStatus: s.legal.legalStatus || '',
                inn: s.legal.inn || '',
                ogrn: s.legal.ogrn || '',
                supportEmail: s.legal.supportEmail || '',
                phone: s.legal.phone || '',
                address: s.legal.address || '',
            },
        };
    }

    updateSmtpSettings(patch = {}) {
        const s = this._ensureSettingsObject().smtp;
        if (patch.host !== undefined) s.host = String(patch.host || '').trim();
        if (patch.port !== undefined) s.port = Number(patch.port || 465);
        if (patch.secure !== undefined) s.secure = Boolean(patch.secure);
        if (patch.user !== undefined) s.user = String(patch.user || '').trim();
        if (patch.pass !== undefined && !isMaskedSecret(patch.pass)) {
            s.pass = String(patch.pass || '');
        }
        if (patch.fromEmail !== undefined) s.fromEmail = String(patch.fromEmail || '').trim();
        if (patch.senderName !== undefined) s.senderName = String(patch.senderName || '').trim();
        this._writeMailFile();
        this._save();
        return this.getAdminSettingsSummary();
    }

    updateYooKassaSettings(patch = {}) {
        const y = this._ensureSettingsObject().yookassa;
        if (patch.shopId !== undefined) y.shopId = String(patch.shopId || '').trim();
        if (patch.secretKey !== undefined && !isMaskedSecret(patch.secretKey)) {
            y.secretKey = String(patch.secretKey || '').trim();
        }
        if (patch.sendReceipt !== undefined) y.sendReceipt = Boolean(patch.sendReceipt);
        this._save();
        return this.getAdminSettingsSummary();
    }

    updateBotsSettings(patch = {}) {
        const b = this._ensureSettingsObject().bots;
        if (patch.telegramToken !== undefined && !isMaskedSecret(patch.telegramToken)) {
            b.telegramToken = String(patch.telegramToken || '').trim();
        }
        if (patch.telegramUsername !== undefined) {
            b.telegramUsername = String(patch.telegramUsername || '').trim().replace(/^@+/, '');
        }
        if (patch.maxToken !== undefined && !isMaskedSecret(patch.maxToken)) {
            b.maxToken = String(patch.maxToken || '').trim();
        }
        if (patch.maxUsername !== undefined) {
            b.maxUsername = String(patch.maxUsername || '').trim().replace(/^@+/, '');
        }
        this._save();
        return this.getAdminSettingsSummary();
    }

    updateLegalSettings(patch = {}) {
        const l = this._ensureSettingsObject().legal;
        for (const k of ['companyName', 'authorName', 'legalStatus', 'inn', 'ogrn', 'supportEmail', 'phone', 'address']) {
            if (patch[k] !== undefined) {
                l[k] = String(patch[k] || '').trim();
            }
        }
        this._save();
        return this.getAdminSettingsSummary();
    }

    _recoverAuthorityKeyFromCandidates() {
        const allRoots = [...this.extraSearchRoots];
        const dirs = findCandidateRecoveryDirs({
            primaryDir: this.dataDir,
            extraSearchRoots: allRoots,
            includeSystemDefaults: !(isTestTempPath(this.dataDir) && allRoots.length > 0),
        });
        let bestKeyFile = '';
        let bestMtime = 0;
        for (const d of dirs) {
            const kf = path.join(d, 'authority-key.json');
            if (path.resolve(kf) === path.resolve(this.keyFile)) continue;
            try {
                if (!fs.existsSync(kf)) continue;
                const stat = fs.statSync(kf);
                const parsed = JSON.parse(fs.readFileSync(kf, 'utf8'));
                if (parsed?.publicKey && parsed?.privateKey && stat.mtimeMs >= bestMtime) {
                    bestKeyFile = kf;
                    bestMtime = stat.mtimeMs;
                }
            }
            catch { /* ignore */ }
        }
        if (bestKeyFile) {
            try {
                fs.mkdirSync(path.dirname(this.keyFile), { recursive: true });
                fs.copyFileSync(bestKeyFile, this.keyFile);
                console.log(`[work.odant.org] Восстановлен ключ ЦС authority-key.json из: ${bestKeyFile}`);
            }
            catch { /* ignore */ }
        }
    }

    _tryParseStateFile(filePath) {
        try {
            if (!filePath || !fs.existsSync(filePath)) return null;
            const text = fs.readFileSync(filePath, 'utf8').trim();
            if (!text) return null;
            const raw = JSON.parse(text);
            const stateObj = (raw?.state && typeof raw.state === 'object' && (raw.state.users || raw.state.licenses))
                ? raw.state
                : raw;
            if (!stateObj || typeof stateObj !== 'object') return null;
            return {
                licenses: stateObj.licenses || {},
                orders: stateObj.orders || {},
                tickets: stateObj.tickets || {},
                botBindings: stateObj.botBindings || {},
                partners: stateObj.partners || {},
                reservations: stateObj.reservations || {},
                certificates: stateObj.certificates || {},
                users: stateObj.users || {},
                settings: stateObj.settings || {},
            };
        }
        catch {
            return null;
        }
    }

    getStoreCounts(state = this.state) {
        return {
            users: Object.keys(state?.users || {}).length,
            licenses: Object.keys(state?.licenses || {}).length,
            orders: Object.keys(state?.orders || {}).length,
            reservations: Object.keys(state?.reservations || {}).length,
            partners: Object.keys(state?.partners || {}).length,
            tickets: Object.keys(state?.tickets || {}).length,
        };
    }

    _load() {
        let loaded = this._tryParseStateFile(this.stateFile);
        const mainExistsNonEmpty = fs.existsSync(this.stateFile) && fs.statSync(this.stateFile).size > 50;

        if (!loaded && mainExistsNonEmpty) {
            console.warn(`[work.odant.org] Внимание: не удалось прочитать ${this.stateFile}, проверяем резервные копии...`);
            loaded = this._tryParseStateFile(this.prevStateFile);
            if (!loaded && fs.existsSync(this.backupDir)) {
                try {
                    const bFiles = fs.readdirSync(this.backupDir)
                        .filter(f => f.endsWith('.json'))
                        .sort()
                        .reverse();
                    for (const bf of bFiles) {
                        loaded = this._tryParseStateFile(path.join(this.backupDir, bf));
                        if (loaded) {
                            console.log(`[work.odant.org] Состояние восстановлено из резервной копии: ${bf}`);
                            break;
                        }
                    }
                }
                catch { /* ignore */ }
            }
            if (!loaded) {
                this._readFailedGuard = true;
            }
        }

        if (loaded) {
            this.state = mergeStoreStates(this.state, loaded);
        }

        if (this.autoRecover) {
            this.recoverFromExternalLocations({ silentIfZero: true });
        }
        else if (loaded) {
            this._ensureBootstrapAdmin();
            this._resignAllWithAuthority();
        }
    }

    /**
     * Просканировать кэш npx (~/.npm/_npx/*, %LOCALAPPDATA%/npm-cache/_npx/*), домашнее зеркало и рабочие папки,
     * и безопасно объединить все найденные записи store.json в текущую постоянную базу данных.
     */
    recoverFromExternalLocations({ extraSearchRoots = [], silentIfZero = false } = {}) {
        const allRoots = [...this.extraSearchRoots, ...(extraSearchRoots || [])];
        const dirs = findCandidateRecoveryDirs({
            primaryDir: this.dataDir,
            extraSearchRoots: allRoots,
            includeSystemDefaults: !(isTestTempPath(this.dataDir) && allRoots.length > 0),
        });

        const candidates = [];
        for (const d of dirs) {
            const sf = path.join(d, 'store.json');
            if (path.resolve(sf) === path.resolve(this.stateFile)) continue;
            try {
                if (!fs.existsSync(sf)) continue;
                const stat = fs.statSync(sf);
                const parsed = this._tryParseStateFile(sf);
                if (!parsed) continue;
                const counts = this.getStoreCounts(parsed);
                const totalItems = counts.users + counts.licenses + counts.orders + counts.reservations + counts.partners + counts.tickets;
                if (totalItems > 0) {
                    candidates.push({ file: sf, dir: d, mtimeMs: stat.mtimeMs, parsed, counts });
                }
            }
            catch { /* ignore */ }
        }

        // Сортируем от более старых к более новым, чтобы более свежие изменения дополняли старые
        candidates.sort((a, b) => a.mtimeMs - b.mtimeMs);

        const beforeCounts = this.getStoreCounts(this.state);
        const mergedSources = [];

        for (const item of candidates) {
            this.state = mergeStoreStates(this.state, item.parsed);
            mergedSources.push({
                file: item.file,
                counts: item.counts,
            });
        }

        this._ensureBootstrapAdmin();
        this._resignAllWithAuthority();

        const afterCounts = this.getStoreCounts(this.state);
        const addedOrMerged = (afterCounts.users > beforeCounts.users)
            || (afterCounts.licenses > beforeCounts.licenses)
            || (afterCounts.orders > beforeCounts.orders)
            || (afterCounts.reservations > beforeCounts.reservations)
            || !fs.existsSync(this.stateFile);

        if (mergedSources.length > 0 && addedOrMerged) {
            this._readFailedGuard = false;
            try { this._save(); } catch { /* ignore */ }
            if (!silentIfZero || afterCounts.users > beforeCounts.users || afterCounts.licenses > beforeCounts.licenses) {
                console.log(
                    `[work.odant.org] Автовосстановление данных (источников: ${mergedSources.length}): `
                    + `пользователей=${afterCounts.users}, серверов/лицензий=${afterCounts.licenses}, `
                    + `заказов=${afterCounts.orders}, франшиз=${afterCounts.reservations}`
                );
            }
        }

        return {
            ok: true,
            dataDir: this.dataDir,
            scannedDirs: dirs,
            mergedSources,
            beforeCounts,
            counts: afterCounts,
        };
    }

    /**
     * Сформировать полный пакет резервной копии базы данных для скачивания из /admin.
     */
    exportBackupBundle() {
        let backups = [];
        try {
            if (fs.existsSync(this.backupDir)) {
                backups = fs.readdirSync(this.backupDir)
                    .filter(f => f.endsWith('.json'))
                    .sort()
                    .reverse()
                    .slice(0, 14);
            }
        }
        catch { /* ignore */ }

        return {
            schema: 'ODANT-WORK-LICENSE-STORE-BACKUP-v1',
            exportedAt: new Date().toISOString(),
            dataDir: this.dataDir,
            authorityPublicKey: this.authorityKeys.publicKey,
            counts: this.getStoreCounts(this.state),
            backups,
            state: this.state,
        };
    }

    /**
     * Восстановить или безопасно объединить (merge) базу данных из резервной копии JSON.
     */
    importBackupBundle(payload = {}, { mode = 'merge' } = {}) {
        const parsed = (payload?.state && typeof payload.state === 'object')
            ? payload.state
            : payload;
        if (!parsed || typeof parsed !== 'object' || (!parsed.users && !parsed.licenses && !parsed.orders)) {
            throw new Error('Некорректный формат файла резервной копии (ожидается JSON с разделами users / licenses / orders)');
        }

        // Перед импортом обязательно сохраняем страховочный снапшот текущего состояния
        try {
            fs.mkdirSync(this.backupDir, { recursive: true });
            const preFile = path.join(this.backupDir, `store-pre-import-${Date.now()}.json`);
            fs.writeFileSync(preFile, JSON.stringify(this.state, null, 2), 'utf8');
        }
        catch { /* ignore */ }

        if (mode === 'replace') {
            this.state = mergeStoreStates({}, parsed);
        }
        else {
            this.state = mergeStoreStates(this.state, parsed);
        }

        this._readFailedGuard = false;
        this._ensureBootstrapAdmin();
        this._resignAllWithAuthority();
        this._save();

        return {
            ok: true,
            mode: mode === 'replace' ? 'replace' : 'merge',
            dataDir: this.dataDir,
            counts: this.getStoreCounts(this.state),
        };
    }

    /**
     * Гарантировать, что все токены владельцев и сертификаты лицензий в store подписаны текущим каноническим ключом ЦС.
     */
    _resignAllWithAuthority() {
        let changed = false;
        for (const [id, lic] of Object.entries(this.state.licenses || {})) {
            if (!lic) continue;
            if (!lic.serverName) {
                lic.serverName = 'Сервер WORK';
                changed = true;
            }
            if (!lic.hubToken || !verifyOwnerAccessToken(lic.hubToken, this.authorityKeys.publicKey)) {
                const tokData = createOwnerAccessToken({
                    hubUrl: lic.hubUrl || 'https://work.odant.org',
                    accountId: lic.ownerAccountId || ('USR-' + id),
                    email: lic.ownerEmail || lic.customer?.email || '',
                    licenseId: lic.licenseId || id,
                    serverName: lic.serverName,
                    tokenId: lic.hubTokenId || '',
                    secret: lic.hubTokenSecret || '',
                    issuedAt: lic.issuedAt || Date.now(),
                }, this.authorityKeys);
                lic.hubToken = tokData.token;
                lic.hubTokenId = tokData.payload.tokenId;
                lic.hubTokenSecret = tokData.payload.secret;
                lic.hubUrl = tokData.payload.hubUrl;
                changed = true;
            }
            if (lic.issuerPublicKey !== this.authorityKeys.publicKey) {
                this.state.licenses[id] = signCertificate(lic, this.authorityKeys);
                changed = true;
            }
        }
        for (const user of Object.values(this.state.users || {})) {
            if (!user) continue;
            if (!user.hubToken || !verifyOwnerAccessToken(user.hubToken, this.authorityKeys.publicKey)) {
                const tokData = createOwnerAccessToken({
                    hubUrl: user.hubUrl || 'https://work.odant.org',
                    accountId: user.userId,
                    email: user.email,
                    licenseId: user.licenseId || '',
                    tokenId: user.hubTokenId || '',
                    secret: user.hubTokenSecret || '',
                    issuedAt: user.createdAt || Date.now(),
                }, this.authorityKeys);
                user.hubToken = tokData.token;
                user.hubTokenId = tokData.payload.tokenId;
                user.hubTokenSecret = tokData.payload.secret;
                changed = true;
            }
        }
        if (changed) {
            try { this._save(); } catch { /* ignore */ }
        }
    }

    _save() {
        const counts = this.getStoreCounts(this.state);
        const totalEntities = counts.users + counts.licenses + counts.orders + counts.reservations + counts.partners + counts.tickets;

        // Защита от перезаписи непустого файла пустым состоянием при сбое чтения
        if (this._readFailedGuard && totalEntities === 0) {
            return;
        }

        fs.mkdirSync(this.dataDir, { recursive: true });

        // Сохраняем предыдущую версию (store.prev.json) и ежедневный снапшот (backups/store-YYYY-MM-DD.json)
        try {
            if (fs.existsSync(this.stateFile) && fs.statSync(this.stateFile).size > 50) {
                fs.copyFileSync(this.stateFile, this.prevStateFile);
                if (totalEntities > 0) {
                    fs.mkdirSync(this.backupDir, { recursive: true });
                    const dayKey = new Date().toISOString().slice(0, 10);
                    const dailyBackup = path.join(this.backupDir, `store-${dayKey}.json`);
                    fs.copyFileSync(this.stateFile, dailyBackup);
                }
            }
        }
        catch { /* ignore */ }

        const serialized = JSON.stringify(this.state, null, 2);
        const writeAtomically = (destPath) => {
            const tmp = `${destPath}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
            fs.writeFileSync(tmp, serialized, 'utf8');
            try {
                fs.renameSync(tmp, destPath);
            }
            catch {
                fs.writeFileSync(destPath, serialized, 'utf8');
                try { fs.unlinkSync(tmp); } catch { /* ignore */ }
            }
        };

        writeAtomically(this.stateFile);

        // Дублируем актуальную базу в системное зеркало профиля пользователя ОС (~/.odant-work-license/data),
        // чтобы даже при запуске npx из другой папки данные всегда оставались едиными.
        if (this.autoRecover && totalEntities > 0) {
            try {
                const mirrorDir = getHomeMirrorDataDir();
                if (path.resolve(mirrorDir) !== path.resolve(this.dataDir)) {
                    fs.mkdirSync(mirrorDir, { recursive: true });
                    writeAtomically(path.join(mirrorDir, 'store.json'));
                    if (fs.existsSync(this.keyFile)) {
                        fs.copyFileSync(this.keyFile, path.join(mirrorDir, 'authority-key.json'));
                    }
                }
            }
            catch { /* ignore */ }
        }
    }

    /**
     * Зарегистрировать или обновить базовую лицензию ПАК (5 вечных мест + 1 год включённой поддержки).
     * Если лицензию выдаёт региональный партнёр (partnerId) — фиксируется партнёр-интегратор,
     * привязка оборудования и годовая гарантия на оборудование от партнёра (1 год).
     */
    issueOrUpdateLicense({
        licenseId,
        serverName = '',
        hwid = '',
        nodeFingerprint = '',
        customer = {},
        ownerAccountId = '',
        ownerEmail = '',
        hubUrl = '',
        partnerId = '',
        hardwareWarrantyYears = 1,
        partnerAddons = {},
        baseSeats = PAK_PRODUCT.baseSeats,
        baseActivated = undefined,
        baseSku = '',
        includedSupportTier = PAK_PRODUCT.includedSupportTier,
    } = {}) {
        const now = Date.now();
        let existing = licenseId ? this.state.licenses[licenseId] : null;
        if (!existing && hwid) {
            existing = Object.values(this.state.licenses).find(l => l.hardware?.hwid === hwid) || null;
        }

        const partner = partnerId ? this.state.partners[partnerId] : (existing?.partner?.partnerId ? this.state.partners[existing.partner.partnerId] : null);
        const warrantyYears = Math.max(1, Number(hardwareWarrantyYears ?? 1));

        const id = existing?.licenseId || licenseId || ('WORK-PAK-' + crypto.randomBytes(4).toString('hex').toUpperCase());
        const issuedAt = existing?.issuedAt || now;
        const bindCode = existing?.support?.bindCode || ('BIND-' + crypto.randomBytes(3).toString('hex').toUpperCase());

        const isBaseActivated = baseActivated !== undefined
            ? Boolean(baseActivated)
            : (existing?.baseActivated !== undefined ? Boolean(existing.baseActivated) : true);

        const resolvedOwnerEmail = String(ownerEmail || customer.email || existing?.ownerEmail || existing?.customer?.email || '').toLowerCase();
        const matchedUser = resolvedOwnerEmail
            ? (this.state.users?.[resolvedOwnerEmail] || Object.values(this.state.users || {}).find(u => String(u.email || '').toLowerCase() === resolvedOwnerEmail))
            : null;
        const resolvedOwnerAccountId = String(ownerAccountId || existing?.ownerAccountId || matchedUser?.userId || '');
        const resolvedServerName = String(serverName || existing?.serverName || 'Сервер WORK #1').trim();
        const resolvedHubUrl = String(hubUrl || existing?.hubUrl || 'https://work.odant.org').replace(/\/+$/, '');

        let hubToken = existing?.hubToken || '';
        let hubTokenId = existing?.hubTokenId || '';
        let hubTokenSecret = existing?.hubTokenSecret || '';
        if (!hubToken || !verifyOwnerAccessToken(hubToken, this.authorityKeys.publicKey)) {
            const tokData = createOwnerAccessToken({
                hubUrl: resolvedHubUrl,
                accountId: resolvedOwnerAccountId || ('USR-' + id),
                email: resolvedOwnerEmail,
                licenseId: id,
                serverName: resolvedServerName,
                issuedAt: now,
            }, this.authorityKeys);
            hubToken = tokData.token;
            hubTokenId = tokData.payload.tokenId;
            hubTokenSecret = tokData.payload.secret;
        }

        const hwidBound = Boolean(hwid || nodeFingerprint || existing?.hardware?.hwidBound);

        const record = {
            licenseId: id,
            serverName: resolvedServerName,
            issuedAt,
            updatedAt: now,
            issuer: 'work.odant.org',
            ownerAccountId: resolvedOwnerAccountId,
            ownerEmail: resolvedOwnerEmail,
            hubToken,
            hubTokenId,
            hubTokenSecret,
            hubUrl: resolvedHubUrl,
            baseActivated: isBaseActivated,
            baseSku: String(baseSku || existing?.baseSku || PAK_PRODUCT.sku),
            customer: {
                name: customer.name || existing?.customer?.name || matchedUser?.companyName || matchedUser?.name || resolvedOwnerEmail || 'Клиент WORK',
                inn: customer.inn || existing?.customer?.inn || matchedUser?.inn || '',
                email: customer.email || existing?.customer?.email || resolvedOwnerEmail || '',
                phone: customer.phone || existing?.customer?.phone || matchedUser?.phone || '',
            },
            hardware: {
                hwid: hwid || existing?.hardware?.hwid || ('PAK-' + crypto.randomBytes(6).toString('hex').toUpperCase()),
                nodeFingerprint: nodeFingerprint || existing?.hardware?.nodeFingerprint || '',
                hwidBound,
                sku: String(baseSku || existing?.hardware?.sku || PAK_PRODUCT.sku),
                cpu: PAK_PRODUCT.hardware.cpu,
                ramGb: PAK_PRODUCT.hardware.ramGb,
                ssdTb: PAK_PRODUCT.hardware.ssdTb,
                warrantyYears,
                warrantyUntil: existing?.hardware?.warrantyUntil || (issuedAt + warrantyYears * ONE_YEAR_MS),
                warrantyProvider: partner ? partner.companyName : (existing?.hardware?.warrantyProvider || 'Партнёр-интегратор WORK'),
            },
            partner: partner ? {
                partnerId: partner.partnerId,
                companyName: partner.companyName,
                regionCode: partner.regionCode,
                regionName: partner.regionName,
                hardwareWarrantyYears: warrantyYears,
                hardwareWarrantyUntil: issuedAt + warrantyYears * ONE_YEAR_MS,
                addons: {
                    nasBackup: Boolean(partnerAddons.nasBackup ?? existing?.partner?.addons?.nasBackup),
                    inferenceHardware: Boolean(partnerAddons.inferenceHardware ?? existing?.partner?.addons?.inferenceHardware),
                    partnerModelApiUrl: String(partnerAddons.partnerModelApiUrl ?? existing?.partner?.addons?.partnerModelApiUrl ?? ''),
                    techSupportContract: Boolean(partnerAddons.techSupportContract ?? existing?.partner?.addons?.techSupportContract ?? true),
                    agentTrainingSkills: Boolean(partnerAddons.agentTrainingSkills ?? existing?.partner?.addons?.agentTrainingSkills),
                },
            } : (existing?.partner || null),
            baseSeats: Number(baseSeats ?? existing?.baseSeats ?? PAK_PRODUCT.baseSeats),
            perpetualBase: true,
            addonSubscriptions: Array.isArray(existing?.addonSubscriptions) ? existing.addonSubscriptions : [],
            support: {
                tier: existing?.support?.tier || includedSupportTier || PAK_PRODUCT.includedSupportTier || 'enterprise',
                includedUntil: existing?.support?.includedUntil || (issuedAt + ONE_YEAR_MS),
                ticketsUsed: Number(existing?.support?.ticketsUsed || 0),
                bindCode,
            },
        };

        const signed = signCertificate(record, this.authorityKeys);
        this.state.licenses[id] = signed;
        this._save();
        return this.getLicenseSummary(id);
    }

    /**
     * Сформировать отдельные подписанные файлы лицензий (.lic.json) для размещения в папке #system локальной системы:
     *  - файл первичной постоянной лицензии (10 вечных пользователей + разрешение агентской системы);
     *  - отдельные файлы для каждой активной временной лицензии (на количество конкурентных пользователей и период).
     */
    buildLicenseFiles(licenseIdOrCode, now = Date.now()) {
        const lic = this.findLicense(licenseIdOrCode);
        if (!lic)
            return [];

        const files = [];
        const ownerAccountId = lic.ownerAccountId || '';
        const ownerEmail = (lic.ownerEmail || lic.customer?.email || '').toLowerCase();

        if (lic.baseActivated !== false) {
            const baseFileObj = signLicenseFile({
                fileId: `BASE-${lic.licenseId}`,
                kind: 'base',
                licenseId: lic.licenseId,
                ownerAccountId,
                ownerEmail,
                issuer: lic.issuer || 'work.odant.org',
                issuedAt: lic.issuedAt || now,
                expiresAt: null,
                perpetual: true,
                seats: Number(lic.baseSeats ?? PAK_PRODUCT.baseSeats),
                years: 0,
                tier: String(lic.support?.tier || 'enterprise').toLowerCase(),
                aiAgentsEnabled: true,
                orderId: lic.baseOrderId || '',
                hardware: {
                    hwid: String(lic.hardware?.hwid || ''),
                    nodeFingerprint: String(lic.hardware?.nodeFingerprint || ''),
                    sku: String(lic.baseSku || lic.hardware?.sku || PAK_PRODUCT.sku),
                },
                customer: {
                    name: String(lic.customer?.name || ''),
                    inn: String(lic.customer?.inn || ''),
                    email: String(lic.customer?.email || ''),
                },
            }, this.authorityKeys);

            files.push({
                fileName: `license-base-${lic.licenseId}.lic.json`,
                kind: 'base',
                licenseFile: baseFileObj,
            });
        }

        for (const sub of (lic.addonSubscriptions || [])) {
            if (!sub || sub.status === 'canceled' || sub.status === 'revoked')
                continue;
            const addonFileObj = signLicenseFile({
                fileId: sub.id,
                kind: 'addon',
                licenseId: lic.licenseId,
                ownerAccountId,
                ownerEmail,
                issuer: lic.issuer || 'work.odant.org',
                issuedAt: Number(sub.issuedAt || now),
                expiresAt: Number(sub.expiresAt || 0),
                perpetual: false,
                seats: Number(sub.seats || 0),
                years: Number(sub.years || 1),
                tier: String(sub.tier || 'business').toLowerCase(),
                aiAgentsEnabled: true,
                orderId: String(sub.orderId || ''),
                hardware: {
                    hwid: String(lic.hardware?.hwid || ''),
                    nodeFingerprint: String(lic.hardware?.nodeFingerprint || ''),
                    sku: String(lic.hardware?.sku || PAK_PRODUCT.sku),
                },
                customer: {
                    name: String(lic.customer?.name || ''),
                    inn: String(lic.customer?.inn || ''),
                    email: String(lic.customer?.email || ''),
                },
            }, this.authorityKeys);

            files.push({
                fileName: `license-addon-${sub.id}.lic.json`,
                kind: 'addon',
                licenseFile: addonFileObj,
            });
        }

        return files;
    }

    /**
     * Выдача и привязка лицензии ПАК непосредственно региональным партнёром
     * (партнёр сам закупает оборудование, устанавливает стек, привязывает HWID и даёт 1 год гарантии на железо).
     */
    partnerIssueLicense({
        partnerId,
        hwid = '',
        nodeFingerprint = '',
        customer = {},
        hardwareWarrantyYears = 1,
        partnerAddons = {},
        recordSaleAmountRub = PAK_PRODUCT.basePriceRub,
    } = {}) {
        const p = this.state.partners[partnerId];
        if (!p)
            throw new Error(`Партнёр ${partnerId} не найден`);
        const licSummary = this.issueOrUpdateLicense({
            hwid,
            nodeFingerprint,
            customer,
            partnerId: p.partnerId,
            hardwareWarrantyYears,
            partnerAddons,
        });
        p.issuedLicenses ??= [];
        if (!p.issuedLicenses.includes(licSummary.licenseId)) {
            p.issuedLicenses.push(licSummary.licenseId);
        }
        if (Number(recordSaleAmountRub) > 0) {
            this.recordPartnerSale(p.partnerId, Number(recordSaleAmountRub));
        }
        this._save();
        return {
            license: this.getLicenseSummary(licSummary.licenseId),
            partner: this.getPartnerSummary(p.partnerId),
        };
    }

    /**
     * Добавить срочную годовую подписку на дополнительные пользовательские места (после оплаты ЮKassa).
     */
    grantAddonSubscription(licenseId, { tier = 'business', seats = 1, years = 1, orderId = '', paymentId = '' } = {}) {
        let lic = this.state.licenses[licenseId];
        if (!lic) {
            this.issueOrUpdateLicense({ licenseId });
            lic = this.state.licenses[licenseId];
        }
        const now = Date.now();
        const tierKey = String(tier || 'business').toLowerCase();
        const tierSpec = SLA_TIERS[tierKey] || SLA_TIERS.business;
        const seatsCount = Math.max(0, Number(seats || 0));
        const yearsCount = Math.max(1, Number(years || 1));

        if (seatsCount > 0) {
            // Ищем, не была ли уже выдана подписка по этому orderId (идемпотентность webhook ЮKassa)
            const already = (lic.addonSubscriptions || []).find(s => orderId && s.orderId === orderId);
            if (!already) {
                lic.addonSubscriptions.push({
                    id: 'SUB-' + crypto.randomBytes(4).toString('hex').toUpperCase(),
                    tier: tierSpec.id,
                    seats: seatsCount,
                    years: yearsCount,
                    issuedAt: now,
                    expiresAt: now + yearsCount * ONE_YEAR_MS,
                    orderId: String(orderId || ''),
                    paymentId: String(paymentId || ''),
                    status: 'active',
                });
            }
        }

        // Повышаем активный уровень поддержки, если докуплен более высокий тариф
        const rank = { start: 1, business: 2, enterprise: 3 };
        if ((rank[tierSpec.id] || 0) > (rank[lic.support?.tier] || 0)) {
            lic.support.tier = tierSpec.id;
        }
        lic.updatedAt = now;
        const signed = signCertificate(lic, this.authorityKeys);
        this.state.licenses[licenseId] = signed;
        this._save();
        return this.getLicenseSummary(licenseId);
    }

    /**
     * Получить развёрнутую сводку по лицензии (с расчётом активных мест, SLA и квоты обращений).
     */
    getLicenseSummary(licenseIdOrCode, now = Date.now()) {
        const lic = this.findLicense(licenseIdOrCode);
        if (!lic)
            return null;

        const baseSeats = Number(lic.baseSeats ?? PAK_PRODUCT.baseSeats);
        const baseSupportUntil = Number(lic.support?.includedUntil || (lic.issuedAt + ONE_YEAR_MS));
        const baseSupportActive = baseSupportUntil > now;

        let addonSeats = 0;
        let highestTier = baseSupportActive ? (lic.support?.tier || PAK_PRODUCT.includedSupportTier || 'enterprise') : null;
        let ticketsQuota = baseSupportActive
            ? baseSeats * (SLA_TIERS[lic.support?.tier || PAK_PRODUCT.includedSupportTier || 'enterprise']?.ticketsLimitPerSeatYear || 9999)
            : 0;

        const rank = { start: 1, business: 2, enterprise: 3 };
        const activeAddons = [];

        for (const sub of (lic.addonSubscriptions || [])) {
            if (sub.status === 'active' && Number(sub.expiresAt) > now && Number(sub.seats) > 0) {
                const tSpec = SLA_TIERS[sub.tier] || SLA_TIERS.start;
                addonSeats += Number(sub.seats);
                ticketsQuota += Number(sub.seats) * tSpec.ticketsLimitPerSeatYear;
                if (!highestTier || (rank[tSpec.id] || 0) > (rank[highestTier] || 0))
                    highestTier = tSpec.id;
                activeAddons.push({ ...sub, tierName: tSpec.name });
            }
        }

        const effectiveTier = SLA_TIERS[highestTier || lic.support?.tier || 'start'] || SLA_TIERS.start;
        if (ticketsQuota === 0)
            ticketsQuota = baseSeats * SLA_TIERS.start.ticketsLimitPerSeatYear;

        const ticketsUsed = Number(lic.support?.ticketsUsed || 0);

        return {
            licenseId: lic.licenseId,
            serverName: lic.serverName || 'Сервер WORK #1',
            issuedAt: lic.issuedAt,
            updatedAt: lic.updatedAt,
            ownerAccountId: lic.ownerAccountId || '',
            ownerEmail: lic.ownerEmail || lic.customer?.email || '',
            hubToken: lic.hubToken || '',
            hubTokenId: lic.hubTokenId || '',
            hubUrl: lic.hubUrl || 'https://work.odant.org',
            hwidBound: Boolean(lic.hardware?.hwidBound),
            baseActivated: lic.baseActivated !== false,
            baseSku: lic.baseSku || PAK_PRODUCT.sku,
            customer: lic.customer,
            hardware: lic.hardware,
            partner: lic.partner || null,
            baseSeats: lic.baseActivated !== false ? baseSeats : 0,
            perpetualBase: lic.baseActivated !== false,
            aiAgentsEnabled: lic.baseActivated !== false,
            addonSeats,
            totalSeats: (lic.baseActivated !== false ? baseSeats : 1) + addonSeats,
            baseSupportUntil,
            baseSupportActive,
            activeAddons,
            support: {
                active: baseSupportActive || activeAddons.length > 0,
                tier: effectiveTier.id,
                tierName: effectiveTier.name,
                reactionMinutes: effectiveTier.reactionMinutes,
                reactionLabel: effectiveTier.reactionLabel,
                scheduleLabel: effectiveTier.scheduleLabel,
                ticketsQuota,
                ticketsUsed,
                ticketsRemaining: Math.max(0, ticketsQuota - ticketsUsed),
                bindCode: lic.support?.bindCode || '',
            },
            certificate: lic,
            licenseFiles: this.buildLicenseFiles(lic.licenseId, now),
        };
    }

    /**
     * Найти лицензию по licenseId, HWID или коду привязки бота (bindCode).
     */
    findLicense(query) {
        const q = String(query || '').trim();
        if (!q)
            return null;
        if (this.state.licenses[q])
            return this.state.licenses[q];
        const upper = q.toUpperCase();
        for (const lic of Object.values(this.state.licenses)) {
            if (
                lic.licenseId.toUpperCase() === upper
                || lic.hardware?.hwid?.toUpperCase() === upper
                || lic.support?.bindCode?.toUpperCase() === upper
            ) {
                return lic;
            }
        }
        return null;
    }

    listLicenses() {
        return Object.keys(this.state.licenses).map(id => this.getLicenseSummary(id));
    }

    /**
     * Создать заказ на покупку ПАК (5 млн ₽), отдельно базовой постоянной лицензии без железа (4 млн ₽),
     * дополнительных годовых лицензий и прочих товаров/услуг (оплата через ЮKassa или по счёту/договору для юрлиц).
     */
    createOrder({
        licenseId = '',
        serverName = '',
        createNewServer = false,
        hwid = '',
        nodeFingerprint = '',
        includeBasePak = false,
        includeBaseLicenseOnly = false,
        tier = 'business',
        addonSeats = 0,
        years = 1,
        extraProductIds = [],
        paymentMethod = 'yookassa',
        customer = {},
        ownerAccountId = '',
        partnerId = '',
        returnUrl = '',
    } = {}) {
        const quote = calculateOrderQuote({
            includeBasePak,
            includeBaseLicenseOnly,
            tier,
            addonSeats,
            years,
            extraProductIds,
        });
        if (quote.totalAmountRub <= 0)
            throw new Error('Сумма заказа должна быть больше 0 ₽');

        const forceNew = Boolean(createNewServer || String(licenseId).toUpperCase() === 'NEW');
        let targetLic = forceNew ? null : this.findLicense(licenseId || hwid);
        if (!targetLic) {
            const existingCount = Object.values(this.state.licenses).filter(
                l => (ownerAccountId && l.ownerAccountId === ownerAccountId)
                    || (customer.email && l.ownerEmail === String(customer.email).toLowerCase())
            ).length;
            targetLic = this.issueOrUpdateLicense({
                licenseId: (!forceNew && licenseId) ? licenseId : undefined,
                serverName: serverName || `Сервер WORK #${existingCount + 1}`,
                baseActivated: forceNew ? false : undefined,
                hwid,
                nodeFingerprint,
                customer,
                ownerAccountId,
                ownerEmail: customer.email || '',
            });
        }

        const partner = partnerId ? this.getPartnerSummary(partnerId) : null;
        const partnerDiscountPercent = partner ? partner.discountPercent : 0;
        const partnerMarginRub = partner ? Math.round(quote.totalAmountRub * (partnerDiscountPercent / 100)) : 0;

        const now = Date.now();
        const orderId = 'ORD-' + now.toString(36).toUpperCase() + '-' + crypto.randomBytes(2).toString('hex').toUpperCase();
        const method = String(paymentMethod || 'yookassa').toLowerCase() === 'invoice' ? 'invoice' : 'yookassa';
        const dateTag = new Date(now).toISOString().slice(0, 10).replace(/-/g, '');
        const shortRand = crypto.randomBytes(2).toString('hex').toUpperCase();

        const order = {
            orderId,
            licenseId: targetLic.licenseId,
            ownerAccountId: ownerAccountId || targetLic.ownerAccountId || '',
            partnerId: partner ? partner.partnerId : '',
            partnerDiscountPercent,
            partnerMarginRub,
            includeBasePak: quote.includeBasePak,
            includeBaseLicenseOnly: quote.includeBaseLicenseOnly,
            basePakPriceRub: quote.basePakPriceRub,
            baseLicenseOnlyPriceRub: quote.baseLicenseOnlyPriceRub,
            tier: quote.tier,
            tierName: quote.tierName,
            addonSeats: quote.addonSeats,
            years: quote.years,
            extraProductIds: Array.isArray(extraProductIds) ? extraProductIds : [],
            extraAmountRub: quote.extraAmountRub || 0,
            amountRub: quote.totalAmountRub,
            items: quote.items,
            paymentMethod: method,
            invoiceNumber: method === 'invoice' ? `СЧ-${dateTag}-${shortRand}` : '',
            contractNumber: method === 'invoice' ? `ДОГ-${dateTag}-${shortRand}` : '',
            invoiceUrl: method === 'invoice' ? `/api/orders/${orderId}/invoice` : '',
            customer: {
                name: (customer.name && !String(customer.name).includes('@')) ? customer.name : ((targetLic.customer?.name && !String(targetLic.customer.name).includes('@')) ? targetLic.customer.name : ''),
                inn: customer.inn || targetLic.customer?.inn || '',
                kpp: customer.kpp || targetLic.customer?.kpp || '',
                legalAddress: customer.legalAddress || targetLic.customer?.legalAddress || '',
                signerName: customer.signerName || targetLic.customer?.signerName || '',
                signerPosition: customer.signerPosition || targetLic.customer?.signerPosition || '',
                bankName: customer.bankName || targetLic.customer?.bankName || '',
                bik: customer.bik || targetLic.customer?.bik || '',
                bankAccount: customer.bankAccount || targetLic.customer?.bankAccount || '',
                corrAccount: customer.corrAccount || targetLic.customer?.corrAccount || '',
                email: customer.email || targetLic.customer?.email || 'billing@odant.org',
                phone: customer.phone || targetLic.customer?.phone || '',
            },
            status: method === 'invoice' ? 'awaiting_invoice' : 'pending',
            paymentId: '',
            paymentOrderNumber: '',
            confirmationUrl: method === 'invoice' ? `/api/orders/${orderId}/invoice` : '',
            returnUrl: returnUrl || 'https://work.odant.org',
            createdAt: now,
            paidAt: null,
        };

        this.state.orders[orderId] = order;
        this._save();
        return order;
    }

    getOrder(orderId) {
        return this.state.orders[orderId] || null;
    }

    findOrderByPaymentId(paymentId) {
        if (!paymentId)
            return null;
        return Object.values(this.state.orders).find(o => o.paymentId === paymentId) || null;
    }

    updateOrder(orderId, patch = {}) {
        const ord = this.state.orders[orderId];
        if (!ord)
            return null;
        Object.assign(ord, patch);
        this._save();
        return ord;
    }

    /**
     * Отметить заказ как оплаченный и выпустить/продлить лицензию.
     */
    completePaidOrder(orderId, { paymentId = '' } = {}) {
        const ord = this.state.orders[orderId];
        if (!ord)
            throw new Error(`Заказ ${orderId} не найден`);
        if (ord.status === 'paid') {
            if ((ord.kind === 'franchise_reservation' || ord.kind === 'franchise_installment') && ord.reservationId && this.state.reservations[ord.reservationId]) {
                const resv = this.state.reservations[ord.reservationId];
                return {
                    order: ord,
                    reservation: this.getFranchiseSummary(resv.reservationId),
                    regionQuota: this.getRegionPartnerQuotaStatus(resv.regionCode),
                    alreadyProcessed: true,
                };
            }
            return {
                order: ord,
                license: this.getLicenseSummary(ord.licenseId),
                alreadyProcessed: true,
            };
        }
        ord.status = 'paid';
        ord.paidAt = Date.now();
        if (paymentId)
            ord.paymentId = paymentId;

        if (ord.kind === 'franchise_reservation' && ord.reservationId && this.state.reservations[ord.reservationId]) {
            const resv = this.state.reservations[ord.reservationId];
            resv.depositPaid = true;
            resv.paidAt = ord.paidAt;
            resv.paymentId = ord.paymentId;
            if (!resv.convertedToPartnerId)
                resv.status = 'deposit_paid';
            // Фиксируем 12-месячный график погашения остатка ровно от даты оплаты начального взноса
            const remainingAfterDeposit = Math.max(0, Number(resv.franchiseFeeRub || 0) - Number(resv.nonRefundableDepositRub || 100_000));
            resv.paymentSchedule = buildFranchisePaymentSchedule({
                remainingRub: remainingAfterDeposit,
                startMs: ord.paidAt,
                existingSchedule: resv.paymentSchedule || [],
            });
            resv.paidInstallmentsRub = (resv.paymentSchedule || [])
                .filter(it => it.status === 'paid')
                .reduce((s, it) => s + Number(it.amountRub || 0), 0);
            resv.totalPaidRub = Number(resv.nonRefundableDepositRub || 100_000) + resv.paidInstallmentsRub;
            resv.remainingFranchiseFeeRub = Math.max(0, Number(resv.franchiseFeeRub || 0) - resv.totalPaidRub);
            this._save();
            return {
                order: ord,
                reservation: this.getFranchiseSummary(resv.reservationId),
                regionQuota: this.getRegionPartnerQuotaStatus(resv.regionCode),
                alreadyProcessed: false,
            };
        }

        if (ord.kind === 'franchise_installment' && ord.reservationId && this.state.reservations[ord.reservationId]) {
            const resv = this.state.reservations[ord.reservationId];
            if (!Array.isArray(resv.paymentSchedule) || !resv.paymentSchedule.length) {
                const rem = Math.max(0, Number(resv.franchiseFeeRub || 0) - Number(resv.nonRefundableDepositRub || 100_000));
                resv.paymentSchedule = buildFranchisePaymentSchedule({
                    remainingRub: rem,
                    startMs: resv.paidAt || resv.createdAt || ord.paidAt,
                });
            }
            const targetMonths = Array.isArray(ord.installmentMonths) && ord.installmentMonths.length
                ? new Set(ord.installmentMonths.map(Number))
                : null;
            for (const inst of resv.paymentSchedule) {
                if (inst.status === 'paid') continue;
                if (ord.earlyPayoff || (targetMonths && targetMonths.has(Number(inst.monthNumber)))) {
                    inst.status = 'paid';
                    inst.paidAt = ord.paidAt;
                    inst.orderId = ord.orderId;
                    inst.paymentId = ord.paymentId || '';
                }
            }
            resv.paidInstallmentsRub = resv.paymentSchedule
                .filter(it => it.status === 'paid')
                .reduce((s, it) => s + Number(it.amountRub || 0), 0);
            resv.totalPaidRub = (resv.depositPaid ? Number(resv.nonRefundableDepositRub || 100_000) : 0) + resv.paidInstallmentsRub;
            resv.remainingFranchiseFeeRub = Math.max(0, Number(resv.franchiseFeeRub || 0) - resv.totalPaidRub);
            if (resv.remainingFranchiseFeeRub <= 0 && !resv.convertedToPartnerId) {
                resv.status = 'paid_in_full';
            }
            this._save();
            return {
                order: ord,
                reservation: this.getFranchiseSummary(resv.reservationId),
                regionQuota: this.getRegionPartnerQuotaStatus(resv.regionCode),
                alreadyProcessed: false,
            };
        }

        // Если заказ включает базовый комплект с железом (5 млн ₽) или базовую лицензию без железа (4 млн ₽) —
        // активируем базовую постоянную лицензию на 10 вечных пользователей
        if (ord.includeBasePak || ord.includeBaseLicenseOnly) {
            const rawLic = this.state.licenses[ord.licenseId];
            if (rawLic) {
                rawLic.baseActivated = true;
                rawLic.baseSeats = PAK_PRODUCT.baseSeats;
                rawLic.perpetualBase = true;
                rawLic.baseSku = ord.includeBasePak ? PAK_PRODUCT.sku : BASE_LICENSE_PRODUCT.sku;
                rawLic.baseOrderId = ord.orderId;
                if (ord.ownerAccountId) rawLic.ownerAccountId = ord.ownerAccountId;
                if (ord.customer?.email) rawLic.ownerEmail = String(ord.customer.email).toLowerCase();
                this.state.licenses[ord.licenseId] = signCertificate(rawLic, this.authorityKeys);
            }
        }

        const license = this.grantAddonSubscription(ord.licenseId, {
            tier: ord.tier,
            seats: ord.addonSeats,
            years: ord.years,
            orderId: ord.orderId,
            paymentId: ord.paymentId,
        });
        let partner = null;
        if (ord.partnerId && this.state.partners[ord.partnerId]) {
            partner = this.recordPartnerSale(ord.partnerId, ord.amountRub);
        }
        this._save();
        return { order: ord, license, partner, alreadyProcessed: false };
    }

    /**
     * Подтвердить оплату заказа по договору (счёту) для юридических лиц (безналичный расчёт).
     */
    confirmInvoicePayment(orderId, { paymentOrderNumber = '', paidAt = Date.now(), comment = '' } = {}) {
        const ord = this.state.orders[orderId];
        if (!ord)
            throw new Error(`Заказ ${orderId} не найден`);
        ord.paymentOrderNumber = String(paymentOrderNumber || ord.invoiceNumber || `ПП-${orderId}`).trim();
        if (comment)
            ord.invoiceComment = String(comment).trim();
        if (paidAt)
            ord.invoiceConfirmedAt = Number(paidAt) || Date.now();
        return this.completePaidOrder(orderId, { paymentId: ord.paymentOrderNumber });
    }

    /**
     * Сформировать печатную форму Счёта-договора на оплату для юридических лиц.
     */
    renderOrderInvoiceHtml(orderId) {
        const ord = this.state.orders[orderId];
        if (!ord)
            return null;
        const dateStr = new Date(ord.createdAt || Date.now()).toLocaleDateString('ru-RU');
        const c = ord.customer || {};
        const legal = this.getLegalSettings();
        const vendorTitle = legal.companyName || `ООО «${VENDOR_CONTACTS.company}»`;
        const vendorAddr = legal.address || VENDOR_CONTACTS.address;
        const vendorPhone = legal.phone || VENDOR_CONTACTS.phones.join(', ');
        const custName = (c.name && !String(c.name).includes('@')) ? c.name : 'Организация (не указана)';
        const rowsHtml = (ord.items || []).map((it, idx) => `
            <tr>
                <td style="text-align:center;">${idx + 1}</td>
                <td>${it.title}</td>
                <td style="text-align:center;font-weight:700;">${it.quantity}</td>
                <td style="text-align:right;">${Number(it.unitPriceRub || 0).toLocaleString('ru-RU')} ₽</td>
                <td style="text-align:right;font-weight:700;">${Number(it.totalRub || 0).toLocaleString('ru-RU')} ₽</td>
            </tr>
        `).join('');

        return `<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="utf-8">
    <title>Счёт-договор № ${ord.invoiceNumber || ord.orderId} от ${dateStr}</title>
    <style>
        body { font-family: Arial, sans-serif; color: #111827; max-width: 880px; margin: 20px auto; padding: 20px; line-height: 1.45; }
        h1 { font-size: 20px; margin: 0 0 4px; }
        table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 13px; }
        th, td { border: 1px solid #cbd5e1; padding: 8px 10px; }
        th { background: #f1f5f9; text-align: left; }
        .meta { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px 16px; font-size: 13px; }
        .status { display: inline-block; padding: 5px 12px; border-radius: 999px; font-size: 12px; font-weight: 700; background: ${ord.status === 'paid' ? '#dcfce7' : '#fef3c7'}; color: ${ord.status === 'paid' ? '#166534' : '#92400e'}; }
        .toolbar { display: flex; justify-content: space-between; align-items: center; background: #0f172a; color: #f8fafc; padding: 10px 16px; border-radius: 10px; margin-bottom: 18px; }
        .toolbar button { background: #2563eb; color: #fff; border: none; border-radius: 6px; padding: 8px 14px; font-size: 13px; font-weight: 700; cursor: pointer; }
        .toolbar button.sec { background: #334155; margin-left: 8px; }
        .sig-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 28px; font-size: 13px; }
        .sig-box { border-top: 1px solid #cbd5e1; padding-top: 10px; }
        @media print { .no-print { display: none !important; } body { margin: 0; padding: 10px; } }
    </style>
</head>
<body>
    <div class="toolbar no-print">
        <div style="font-size:13.5px;font-weight:700;">Счёт-договор № ${ord.invoiceNumber || ord.orderId} · ODANT-WORK</div>
        <div>
            <button type="button" onclick="window.print()">Печать / Сохранить в PDF</button>
            <button type="button" class="sec" onclick="window.close()">Закрыть вкладку</button>
        </div>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;">
        <div>
            <h1>Счёт-договор № ${ord.invoiceNumber || ord.orderId} от ${dateStr}</h1>
            <div style="font-size:13px;color:#475569;">Договор № ${ord.contractNumber || ord.orderId} · Заказ № ${ord.orderId} · Сервер: ${ord.licenseId || '—'}</div>
        </div>
        <span class="status">${ord.status === 'paid' ? 'ОПЛАЧЕН' : 'ОЖИДАЕТ ОПЛАТЫ ПО СЧЁТУ'}</span>
    </div>
    <div class="meta" style="margin-top:14px;">
        <div><strong>Поставщик (Лицензиар):</strong> ${vendorTitle}${legal.inn ? `, ИНН: ${legal.inn}` : ''}${legal.ogrn ? `, ОГРН: ${legal.ogrn}` : ''}, адрес: ${vendorAddr}, тел.: ${vendorPhone}</div>
        <div style="margin-top:8px;">
            <strong>Покупатель (Лицензиат):</strong> ${custName}, ИНН: ${c.inn || '—'}${c.kpp ? ', КПП: ' + c.kpp : ''}
            ${c.legalAddress ? `<br><strong>Юридический адрес:</strong> ${c.legalAddress}` : ''}
            ${c.bankName || c.bankAccount ? `<br><strong>Банковские реквизиты:</strong> р/с ${c.bankAccount || '—'} в ${c.bankName || '—'}${c.bik ? ', БИК ' + c.bik : ''}${c.corrAccount ? ', к/с ' + c.corrAccount : ''}` : ''}
            ${c.signerName ? `<br><strong>Уполномоченное лицо:</strong> ${c.signerPosition ? c.signerPosition + ' ' : ''}${c.signerName}` : ''}
            <br><strong>Контакты:</strong> Email: ${c.email || '—'}${c.phone ? ', тел.: ' + c.phone : ''}
        </div>
    </div>
    <table>
        <thead>
            <tr>
                <th style="width:40px;">№</th>
                <th>Наименование лицензии / программно-аппаратного комплекса / услуги</th>
                <th style="width:85px;text-align:center;">Кол-во мест / шт.</th>
                <th style="width:130px;text-align:right;">Цена за ед.</th>
                <th style="width:140px;text-align:right;">Сумма</th>
            </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
        <tfoot>
            <tr>
                <td colspan="4" style="text-align:right;font-weight:700;">ИТОГО К ОПЛАТЕ (НДС не облагается на основании пп. 26 п. 2 ст. 149 НК РФ / УСН):</td>
                <td style="text-align:right;font-weight:800;font-size:15px;">${Number(ord.amountRub || 0).toLocaleString('ru-RU')} ₽</td>
            </tr>
        </tfoot>
    </table>
    <p style="font-size:12.5px;color:#475569;">
        1. Оплата настоящего счёта-договора означает акцепт Лицензиатом условий Публичного договора-оферты ODANT-WORK (${PUBLIC_OFERTA.version}).<br>
        2. В назначении платежа обязательно укажите: «Оплата по счёту-договору № ${ord.invoiceNumber || ord.orderId} от ${dateStr} за лицензии ODANT-WORK (заказ ${ord.orderId}). Без НДС».<br>
        3. После зачисления средств файлы лицензий (<code>.lic.json</code>) автоматически активируются в Личном кабинете (${c.email || ''}) для сервера <code>${ord.licenseId || ''}</code>.
    </p>
    <div class="sig-grid">
        <div class="sig-box">
            <strong>От Поставщика (Лицензиара):</strong><br>
            ${vendorTitle}<br><br>
            ______________________ / ${legal.authorName || 'Руководитель'} /
        </div>
        <div class="sig-box">
            <strong>От Покупателя (Лицензиата):</strong><br>
            ${custName}<br><br>
            ______________________ / ${c.signerName || 'Руководитель'} /
        </div>
    </div>
</body>
</html>`;
    }

    /**
     * Отменить неоплаченный заказ (при отмене резерва франшизы также освобождает региональную квоту).
     */
    cancelOrder(orderId) {
        const ord = this.state.orders[orderId];
        if (!ord)
            throw new Error(`Заказ ${orderId} не найден`);
        if (ord.status === 'paid')
            throw new Error(`Заказ ${orderId} уже оплачен и не может быть отменён без возврата`);
        ord.status = 'canceled';
        ord.canceledAt = Date.now();
        let regionQuota = null;
        if (ord.kind === 'franchise_reservation' && ord.reservationId && this.state.reservations[ord.reservationId]) {
            const resv = this.state.reservations[ord.reservationId];
            if (!resv.convertedToPartnerId) {
                resv.status = 'canceled';
                resv.canceledAt = ord.canceledAt;
            }
            regionQuota = this.getRegionPartnerQuotaStatus(resv.regionCode);
        }
        this._save();
        return { ok: true, orderId: ord.orderId, order: ord, regionQuota };
    }

    /**
     * Привязать чат мессенджера (MAX, Telegram, VK) к лицензии ПАК.
     */
    bindBotChat({ channel, chatId, userName = '', codeOrLicenseId }) {
        const lic = this.findLicense(codeOrLicenseId);
        if (!lic)
            throw new Error('Лицензия или код привязки не найден. Проверьте код в разделе «Лицензия ПАК» вашего сервера WORK.');
        const key = `${String(channel).toLowerCase()}:${String(chatId)}`;
        this.state.botBindings[key] = {
            channel: String(channel).toLowerCase(),
            chatId: String(chatId),
            userName: String(userName || ''),
            licenseId: lic.licenseId,
            boundAt: Date.now(),
        };
        this._save();
        return this.getLicenseSummary(lic.licenseId);
    }

    getBoundLicenseForChat(channel, chatId) {
        const key = `${String(channel).toLowerCase()}:${String(chatId)}`;
        const binding = this.state.botBindings[key];
        if (!binding?.licenseId)
            return null;
        return this.getLicenseSummary(binding.licenseId);
    }

    getBindingsForLicense(licenseId) {
        return Object.values(this.state.botBindings).filter(b => b.licenseId === licenseId);
    }

    /**
     * Создать обращение (тикет) в техподдержку из MAX, Telegram, VK или веб-панели
     * с автоматическим контролем квоты обращений и SLA времени реакции по тарифу (Start / Business / Enterprise).
     */
    createSupportTicket({
        licenseId,
        channel = 'telegram',
        chatId = '',
        userName = 'Клиент',
        text = '',
    }) {
        const summary = this.getLicenseSummary(licenseId);
        if (!summary)
            throw new Error('Лицензия ПАК не найдена');

        if (summary.support.ticketsRemaining <= 0) {
            throw new Error(
                `Исчерпан годовой лимит обращений по тарифу ${summary.support.tierName} `
                + `(${summary.support.ticketsUsed}/${summary.support.ticketsQuota}). `
                + `Для увеличения лимита и ускорения реакции перейдите на тариф Business или Enterprise на https://work.odant.org`
            );
        }

        const rawLic = this.state.licenses[summary.licenseId];
        rawLic.support.ticketsUsed = Number(rawLic.support?.ticketsUsed || 0) + 1;

        const now = Date.now();
        const reactionMinutes = summary.support.reactionMinutes;
        const slaDeadlineAt = now + reactionMinutes * 60_000;
        const ticketId = 'TCK-' + Object.keys(this.state.tickets).length.toString().padStart(4, '0') + '-' + crypto.randomBytes(2).toString('hex').toUpperCase();

        const ticket = {
            ticketId,
            licenseId: summary.licenseId,
            customerName: summary.customer?.name || 'Клиент ПАК WORK',
            channel: String(channel).toLowerCase(),
            chatId: String(chatId),
            userName: String(userName),
            tier: summary.support.tier,
            tierName: summary.support.tierName,
            reactionMinutes,
            reactionLabel: summary.support.reactionLabel,
            slaDeadlineAt,
            status: 'open',
            createdAt: now,
            firstReplyAt: null,
            slaMet: null,
            messages: [
                {
                    from: 'client',
                    author: userName,
                    text: String(text || '').trim(),
                    time: now,
                },
            ],
        };

        this.state.tickets[ticketId] = ticket;
        this._save();
        return {
            ticket,
            license: this.getLicenseSummary(summary.licenseId),
        };
    }

    /**
     * Ответить на тикет от лица инженера поддержки (и зафиксировать выполнение SLA времени реакции).
     */
    replyToTicket(ticketId, { engineerName = 'Инженер поддержки ODANT', text = '' } = {}) {
        const t = this.state.tickets[ticketId];
        if (!t)
            throw new Error(`Тикет ${ticketId} не найден`);
        const now = Date.now();
        if (!t.firstReplyAt) {
            t.firstReplyAt = now;
            t.slaMet = now <= t.slaDeadlineAt;
        }
        t.status = 'answered';
        t.messages.push({
            from: 'support',
            author: engineerName,
            text: String(text || '').trim(),
            time: now,
        });
        this._save();
        return t;
    }

    closeTicket(ticketId) {
        const t = this.state.tickets[ticketId];
        if (!t)
            throw new Error(`Тикет ${ticketId} не найден`);
        t.status = 'closed';
        t.closedAt = Date.now();
        this._save();
        return t;
    }

    listTickets({ licenseId = '' } = {}) {
        const all = Object.values(this.state.tickets).sort((a, b) => b.createdAt - a.createdAt);
        if (licenseId)
            return all.filter(t => t.licenseId === licenseId);
        return all;
    }

    _findUser(sessionKeyOrEmail = '') {
        const key = String(sessionKeyOrEmail || '').trim();
        if (!key || this.revokedSessions.has(key))
            return null;
        let found = Object.values(this.state.users || {}).find(
            u => u.sessionKey === key || u.email === key.toLowerCase() || u.userId === key
        ) || null;
        if (found)
            return found;

        // Если контейнер перезапускался, проверяем криптографическую подпись бессрочного токена сессии wks_1...
        const verifiedPayload = verifySessionToken(key, this.authorityKeys.publicKey);
        if (verifiedPayload?.email) {
            const cleanEmail = String(verifiedPayload.email).toLowerCase();
            let user = this.state.users[cleanEmail];
            if (!user) {
                this.registerOrLoginUser({
                    email: cleanEmail,
                    name: verifiedPayload.name || '',
                    companyName: verifiedPayload.companyName || '',
                    inn: verifiedPayload.inn || '',
                    ofertaAccepted: true,
                });
                user = this.state.users[cleanEmail];
            }
            if (user) {
                if (verifiedPayload.isAdmin) {
                    user.isAdmin = true;
                    user.role = 'ADMIN';
                }
                user.sessionKey = key;
                try { this._save(); } catch { /* ignore */ }
                return user;
            }
        }
        return null;
    }

    /**
     * 1.1 Реестр серверов (устройств) пользователя: каждый сервер со своим токеном (owk1...) и своими лицензиями.
     */
    listUserServers(userOrKey, now = Date.now()) {
        const user = typeof userOrKey === 'object' ? userOrKey : this._findUser(userOrKey);
        if (!user)
            return [];
        const userEmail = String(user.email || '').toLowerCase();
        const serverLics = Object.values(this.state.licenses || {})
            .filter(lic => lic && (
                (user.userId && lic.ownerAccountId === user.userId)
                || (user.licenseId && lic.licenseId === user.licenseId)
                || (userEmail && String(lic.ownerEmail || lic.customer?.email || '').toLowerCase() === userEmail)
            ))
            .sort((a, b) => (a.issuedAt || 0) - (b.issuedAt || 0));

        return serverLics.map((lic, idx) => {
            const summary = this.getLicenseSummary(lic.licenseId, now);
            const serverOrders = Object.values(this.state.orders || {})
                .filter(o => o.status !== 'canceled'
                    && o.licenseId === lic.licenseId
                    && o.kind !== 'franchise_reservation'
                    && o.kind !== 'franchise_installment'
                )
                .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
            return {
                ...summary,
                serverName: lic.serverName || `Сервер WORK #${idx + 1}`,
                hubToken: lic.hubToken || user.hubToken || '',
                hubTokenId: lic.hubTokenId || user.hubTokenId || '',
                orders: serverOrders,
            };
        });
    }

    /**
     * Добавить новый лицензируемый сервер (устройство) WORK в Личном кабинете со своим токеном привязки.
     */
    createUserServer(sessionKeyOrEmail = '', {
        serverName = '',
        hwid = '',
        hubUrl = 'https://work.odant.org',
    } = {}) {
        const user = this._findUser(sessionKeyOrEmail);
        if (!user)
            throw new Error('Войдите в Личный кабинет, чтобы добавить сервер');
        const existingServers = this.listUserServers(user);
        const cleanName = String(serverName || '').trim() || `Сервер WORK #${existingServers.length + 1}`;
        const summary = this.issueOrUpdateLicense({
            serverName: cleanName,
            hwid: hwid || '',
            baseActivated: false,
            ownerAccountId: user.userId,
            ownerEmail: user.email,
            hubUrl: hubUrl || user.hubUrl || 'https://work.odant.org',
            customer: {
                name: (user.companyName && !String(user.companyName).includes('@')) ? user.companyName : '',
                inn: user.inn || '',
                kpp: user.kpp || '',
                legalAddress: user.legalAddress || '',
                email: user.email,
                phone: user.phone || '',
            },
        });
        if (!user.licenseId) {
            user.licenseId = summary.licenseId;
        }
        this._save();
        return {
            ok: true,
            server: this.getLicenseSummary(summary.licenseId),
            user: this._formatUserResponse(user),
        };
    }

    /**
     * Переименовать сервер (устройство) в реестре серверов пользователя.
     */
    renameUserServer(sessionKeyOrEmail = '', { licenseId = '', serverName = '' } = {}) {
        const user = this._findUser(sessionKeyOrEmail);
        const lic = this.state.licenses[licenseId];
        if (!lic)
            throw new Error(`Сервер ${licenseId} не найден`);
        if (user && !user.isAdmin && lic.ownerAccountId && lic.ownerAccountId !== user.userId)
            throw new Error('Нет прав на изменение этого сервера');
        const cleanName = String(serverName || '').trim();
        if (!cleanName)
            throw new Error('Укажите название сервера');
        lic.serverName = cleanName;
        lic.updatedAt = Date.now();
        this.state.licenses[licenseId] = signCertificate(lic, this.authorityKeys);
        this._save();
        return {
            ok: true,
            server: this.getLicenseSummary(licenseId),
            user: user ? this._formatUserResponse(user) : null,
        };
    }

    /**
     * Удалить неактивированный сервер из реестра серверов пользователя (если на нём нет оплаченных лицензий).
     */
    deleteUserServer(sessionKeyOrEmail = '', { licenseId = '' } = {}) {
        const user = this._findUser(sessionKeyOrEmail);
        const lic = this.state.licenses[licenseId];
        if (!lic)
            throw new Error(`Сервер ${licenseId} не найден`);
        if (user && !user.isAdmin && lic.ownerAccountId && lic.ownerAccountId !== user.userId)
            throw new Error('Нет прав на удаление этого сервера');
        const hasPaidAddons = Array.isArray(lic.addonSubscriptions) && lic.addonSubscriptions.some(s => s.status === 'active');
        if (lic.baseActivated || hasPaidAddons)
            throw new Error('Нельзя удалить сервер с активированной платной лицензией');
        // Отменяем неоплаченные заказы этого сервера
        for (const ord of Object.values(this.state.orders || {})) {
            if (ord.licenseId === licenseId && ord.status !== 'paid') {
                ord.status = 'canceled';
                ord.canceledAt = Date.now();
            }
        }
        delete this.state.licenses[licenseId];
        if (user && user.licenseId === licenseId) {
            const remaining = this.listUserServers(user);
            user.licenseId = remaining[0]?.licenseId || '';
        }
        this._save();
        return {
            ok: true,
            deletedLicenseId: licenseId,
            user: user ? this._formatUserResponse(user) : null,
        };
    }

    /**
     * Сбросить привязку оборудования (HWID / nodeFingerprint) у сервера (действие администратора при замене железа).
     */
    resetServerHwid(licenseId = '') {
        const lic = this.state.licenses[licenseId];
        if (!lic)
            throw new Error(`Сервер ${licenseId} не найден`);
        lic.hardware = {
            ...lic.hardware,
            hwid: 'PAK-' + crypto.randomBytes(6).toString('hex').toUpperCase(),
            nodeFingerprint: '',
            hwidBound: false,
        };
        lic.updatedAt = Date.now();
        this.state.licenses[licenseId] = signCertificate(lic, this.authorityKeys);
        this._save();
        return this.getLicenseSummary(licenseId);
    }

    /**
     * Административное управление сервером и лицензией из /admin (активация/отзыв базовой лицензии, переименование, сброс HWID).
     */
    adminManageServer({
        licenseId = '',
        serverName = undefined,
        baseActivated = undefined,
        baseSku = '',
        resetHwid = false,
        addonSeats = 0,
        addonTier = 'business',
        addonYears = 1,
    } = {}) {
        const lic = this.state.licenses[licenseId];
        if (!lic)
            throw new Error(`Сервер ${licenseId} не найден`);
        if (serverName !== undefined && String(serverName).trim()) {
            lic.serverName = String(serverName).trim();
        }
        if (baseActivated !== undefined) {
            lic.baseActivated = Boolean(baseActivated);
            if (lic.baseActivated) {
                lic.baseSeats = PAK_PRODUCT.baseSeats;
                lic.perpetualBase = true;
                if (baseSku) lic.baseSku = baseSku;
            }
        }
        if (resetHwid) {
            lic.hardware = {
                ...lic.hardware,
                hwid: 'PAK-' + crypto.randomBytes(6).toString('hex').toUpperCase(),
                nodeFingerprint: '',
                hwidBound: false,
            };
        }
        lic.updatedAt = Date.now();
        this.state.licenses[licenseId] = signCertificate(lic, this.authorityKeys);
        if (Number(addonSeats) > 0) {
            return this.grantAddonSubscription(licenseId, {
                tier: addonTier,
                seats: Number(addonSeats),
                years: Number(addonYears) || 1,
                orderId: 'ADM-' + Date.now().toString(36).toUpperCase(),
            });
        }
        this._save();
        return this.getLicenseSummary(licenseId);
    }

    _formatUserResponse(user) {
        if (!user)
            return null;
        this._expireStaleReservations();
        const now = Date.now();
        const userEmail = String(user.email || '').toLowerCase();
        const userOrders = Object.values(this.state.orders || {})
            .filter(o => o.status !== 'canceled' && (
                (user.userId && o.ownerAccountId === user.userId)
                || (user.licenseId && o.licenseId === user.licenseId)
                || (userEmail && String(o.customer?.email || '').toLowerCase() === userEmail)
            ))
            .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        const userFranchises = this.listUserFranchises(user, now);
        const userServers = this.listUserServers(user, now);
        const cleanCompany = (user.companyName && !String(user.companyName).includes('@')) ? user.companyName : '';
        return {
            userId: user.userId,
            email: user.email,
            isAdmin: Boolean(user.isAdmin),
            role: user.isAdmin ? 'ADMIN' : 'CLIENT',
            authProvider: user.authProvider || 'email',
            name: user.name,
            position: user.position || '',
            companyName: cleanCompany,
            inn: user.inn || '',
            kpp: user.kpp || '',
            legalAddress: user.legalAddress || '',
            signerName: user.signerName || '',
            signerPosition: user.signerPosition || user.position || '',
            bankName: user.bankName || '',
            bik: user.bik || '',
            bankAccount: user.bankAccount || '',
            corrAccount: user.corrAccount || '',
            phone: user.phone || '',
            licenseId: user.licenseId,
            sessionKey: user.sessionKey,
            hubToken: user.hubToken || '',
            hubTokenId: user.hubTokenId || '',
            hubUrl: user.hubUrl || 'https://work.odant.org',
            ofertaAccepted: Boolean(user.ofertaAccepted),
            ofertaAcceptedAt: user.ofertaAcceptedAt || null,
            ofertaVersion: user.ofertaVersion || '',
            ofertaSignerName: user.ofertaSignerName || '',
            ofertaSignatureId: user.ofertaSignatureId || '',
            createdAt: user.createdAt,
            lastLoginAt: user.lastLoginAt,
            license: this.getLicenseSummary(user.licenseId, now),
            servers: userServers,
            franchises: userFranchises,
            orders: userOrders,
            reservations: userFranchises,
        };
    }

    /**
     * Обновить и сохранить реквизиты организации (юридического лица / ИП) в профиле Личного кабинета.
     */
    updateUserProfile(sessionKeyOrEmail = '', {
        companyName = undefined,
        inn = undefined,
        kpp = undefined,
        legalAddress = undefined,
        signerName = undefined,
        signerPosition = undefined,
        bankName = undefined,
        bik = undefined,
        bankAccount = undefined,
        corrAccount = undefined,
        phone = undefined,
    } = {}) {
        const user = this._findUser(sessionKeyOrEmail);
        if (!user)
            throw new Error('Пользователь не найден. Пожалуйста, войдите в Личный кабинет.');
        if (companyName !== undefined) {
            const c = String(companyName || '').trim();
            user.companyName = c.includes('@') ? '' : c;
        }
        if (inn !== undefined) user.inn = String(inn || '').trim();
        if (kpp !== undefined) user.kpp = String(kpp || '').trim();
        if (legalAddress !== undefined) user.legalAddress = String(legalAddress || '').trim();
        if (signerName !== undefined) user.signerName = String(signerName || '').trim();
        if (signerPosition !== undefined) {
            user.signerPosition = String(signerPosition || '').trim();
            user.position = user.signerPosition;
        }
        if (bankName !== undefined) user.bankName = String(bankName || '').trim();
        if (bik !== undefined) user.bik = String(bik || '').trim();
        if (bankAccount !== undefined) user.bankAccount = String(bankAccount || '').trim();
        if (corrAccount !== undefined) user.corrAccount = String(corrAccount || '').trim();
        if (phone !== undefined) user.phone = String(phone || '').trim();

        // Синхронизируем реквизиты со всеми серверами и неоплаченными заказами этого клиента
        for (const lic of Object.values(this.state.licenses || {})) {
            if (!lic) continue;
            if (lic.ownerAccountId === user.userId || String(lic.ownerEmail || '').toLowerCase() === user.email) {
                lic.customer = lic.customer || {};
                if (user.companyName) lic.customer.name = user.companyName;
                if (user.inn) lic.customer.inn = user.inn;
                if (user.kpp !== undefined) lic.customer.kpp = user.kpp;
                if (user.legalAddress !== undefined) lic.customer.legalAddress = user.legalAddress;
                if (user.phone !== undefined) lic.customer.phone = user.phone;
                this.state.licenses[lic.licenseId] = signCertificate(lic, this.authorityKeys);
            }
        }
        for (const ord of Object.values(this.state.orders || {})) {
            if (!ord || ord.status === 'paid') continue;
            if (ord.ownerAccountId === user.userId || String(ord.customer?.email || '').toLowerCase() === user.email) {
                ord.customer = ord.customer || {};
                if (user.companyName) ord.customer.name = user.companyName;
                if (user.inn) ord.customer.inn = user.inn;
                if (user.kpp !== undefined) ord.customer.kpp = user.kpp;
                if (user.legalAddress !== undefined) ord.customer.legalAddress = user.legalAddress;
                if (user.signerName !== undefined) ord.customer.signerName = user.signerName;
                if (user.signerPosition !== undefined) ord.customer.signerPosition = user.signerPosition;
                if (user.bankName !== undefined) ord.customer.bankName = user.bankName;
                if (user.bik !== undefined) ord.customer.bik = user.bik;
                if (user.bankAccount !== undefined) ord.customer.bankAccount = user.bankAccount;
                if (user.corrAccount !== undefined) ord.customer.corrAccount = user.corrAccount;
                if (user.phone !== undefined) ord.customer.phone = user.phone;
            }
        }

        // Обновляем подписанный токен сессии с новыми реквизитами
        user.sessionKey = createSessionToken({
            userId: user.userId,
            email: user.email,
            name: user.name,
            companyName: user.companyName,
            inn: user.inn,
            isAdmin: Boolean(user.isAdmin),
            issuedAt: Date.now(),
        }, this.authorityKeys);

        this._save();
        return this._formatUserResponse(user);
    }

    /**
     * Зарегистрировать или авторизовать пользователя личного кабинета ODANT-WORK
     * (по email, через OAuth или через мессенджеры Telegram / MAX / VK).
     * Акцепт договора-оферты фиксируется по факту регистрации (ofertaAccepted = true по умолчанию).
     */
    registerOrLoginUser({
        email = '',
        provider = 'email',
        providerAccount = '',
        name = '',
        position = '',
        companyName = '',
        inn = '',
        phone = '',
        licenseId = '',
        ofertaAccepted = true,
        hubUrl = 'https://work.odant.org',
    } = {}) {
        const cleanProvider = String(provider || 'email').trim().toLowerCase();
        let cleanEmail = String(email || '').trim().toLowerCase();
        if (!cleanEmail && providerAccount) {
            const safeAcc = String(providerAccount).trim().toLowerCase().replace(/[^a-z0-9._+-]/g, '') || 'user';
            cleanEmail = safeAcc.includes('@') ? safeAcc : `${safeAcc}@${cleanProvider}.id.odant.org`;
        }
        if (!cleanEmail || !cleanEmail.includes('@'))
            throw new Error('Укажите корректный email или войдите через мессенджер / OAuth');

        let user = this.state.users[cleanEmail];
        const now = Date.now();
        const userId = user?.userId || ('USR-' + crypto.createHash('sha256').update(cleanEmail).digest('hex').slice(0, 10).toUpperCase());

        if (!user) {
            const safeCompany = (companyName && !String(companyName).includes('@')) ? String(companyName).trim() : '';
            let lic = licenseId ? this.findLicense(licenseId) : null;
            if (!lic) {
                const summary = this.issueOrUpdateLicense({
                    ownerAccountId: userId,
                    ownerEmail: cleanEmail,
                    baseActivated: false,
                    customer: {
                        name: safeCompany,
                        inn: inn || '',
                        email: cleanEmail,
                        phone: phone || '',
                    },
                });
                lic = summary.certificate;
            }
            const tokData = createOwnerAccessToken({
                hubUrl: hubUrl || 'https://work.odant.org',
                accountId: userId,
                email: cleanEmail,
                issuedAt: now,
            }, this.authorityKeys);

            user = {
                userId,
                email: cleanEmail,
                authProvider: cleanProvider,
                name: String(name || safeCompany || cleanEmail.split('@')[0]).trim(),
                position: String(position || '').trim(),
                companyName: safeCompany,
                inn: String(inn || '').trim(),
                kpp: '',
                legalAddress: '',
                signerName: '',
                signerPosition: String(position || '').trim(),
                bankName: '',
                bik: '',
                bankAccount: '',
                corrAccount: '',
                phone: String(phone || '').trim(),
                licenseId: lic.licenseId,
                sessionKey: 'wks_' + crypto.randomBytes(16).toString('hex'),
                hubToken: tokData.token,
                hubTokenId: tokData.payload.tokenId,
                hubTokenSecret: tokData.payload.secret,
                hubUrl: tokData.payload.hubUrl,
                ofertaAccepted: false,
                ofertaAcceptedAt: null,
                ofertaVersion: '',
                ofertaSignerName: '',
                ofertaSignatureId: '',
                createdAt: now,
                lastLoginAt: now,
            };
            this.state.users[cleanEmail] = user;
        }
        else {
            user.lastLoginAt = now;
            if (cleanProvider && cleanProvider !== 'email') user.authProvider = cleanProvider;
            if (name) user.name = String(name).trim();
            if (position) user.position = String(position).trim();
            if (companyName) user.companyName = String(companyName).trim();
            if (inn) user.inn = String(inn).trim();
            if (phone) user.phone = String(phone).trim();
            if (licenseId && this.findLicense(licenseId)) {
                user.licenseId = this.findLicense(licenseId).licenseId;
            }
            if (!user.hubToken) {
                const tokData = createOwnerAccessToken({
                    hubUrl: hubUrl || user.hubUrl || 'https://work.odant.org',
                    accountId: user.userId,
                    email: user.email,
                    issuedAt: now,
                }, this.authorityKeys);
                user.hubToken = tokData.token;
                user.hubTokenId = tokData.payload.tokenId;
                user.hubTokenSecret = tokData.payload.secret;
                user.hubUrl = tokData.payload.hubUrl;
            }
        }

        const isFirstAdmin = !Object.values(this.state.users || {}).some(u => u.isAdmin);
        if (isFirstAdmin) {
            user.isAdmin = true;
            user.role = 'ADMIN';
        }

        // Выпускаем криптографически подписанный бессрочный токен сессии (wks_1...), устойчивый к перезапускам сервера
        user.sessionKey = createSessionToken({
            userId: user.userId,
            email: user.email,
            name: user.name,
            companyName: user.companyName,
            inn: user.inn,
            isAdmin: Boolean(user.isAdmin),
            issuedAt: now,
        }, this.authorityKeys);

        if (ofertaAccepted !== false && !user.ofertaAccepted) {
            user.ofertaAccepted = true;
            user.ofertaAcceptedAt = now;
            user.ofertaVersion = PUBLIC_OFERTA.version;
            user.ofertaSignerName = String(name || user.name || user.companyName || user.email).trim();
            user.ofertaSignatureId = 'PEP-' + crypto.randomBytes(4).toString('hex').toUpperCase();
        }

        // Синхронизируем реквизиты клиента и привязку аккаунта владельца с лицензией
        if (user.licenseId && this.state.licenses[user.licenseId]) {
            const rawLic = this.state.licenses[user.licenseId];
            rawLic.ownerAccountId = user.userId;
            rawLic.ownerEmail = user.email;
            if (user.companyName) rawLic.customer.name = user.companyName;
            if (user.inn) rawLic.customer.inn = user.inn;
            if (user.email) rawLic.customer.email = user.email;
            if (user.phone) rawLic.customer.phone = user.phone;
            this.state.licenses[user.licenseId] = signCertificate(rawLic, this.authorityKeys);
        }

        this._save();
        return this._formatUserResponse(user);
    }

    /**
     * Сгенерировать (или перевыпустить) токен привязки сервера (или владельца) в личном кабинете (содержит URL сервера поддержки и ID сервера).
     */
    generateUserHubToken(sessionKeyOrEmail = '', { licenseId = '', hubUrl = 'https://work.odant.org' } = {}) {
        const user = this._findUser(sessionKeyOrEmail);
        if (!user)
            throw new Error('Аккаунт владельца не найден в личном кабинете');

        const targetLicId = String(licenseId || user.licenseId || '').trim();
        const targetLic = targetLicId ? this.state.licenses[targetLicId] : null;
        const resolvedHubUrl = String(hubUrl || targetLic?.hubUrl || user.hubUrl || 'https://work.odant.org').replace(/\/+$/, '');

        const tokData = createOwnerAccessToken({
            hubUrl: resolvedHubUrl,
            accountId: user.userId,
            email: user.email,
            licenseId: targetLic ? targetLic.licenseId : (user.licenseId || ''),
            serverName: targetLic ? (targetLic.serverName || 'Сервер WORK') : '',
            issuedAt: Date.now(),
        }, this.authorityKeys);

        if (targetLic) {
            targetLic.hubToken = tokData.token;
            targetLic.hubTokenId = tokData.payload.tokenId;
            targetLic.hubTokenSecret = tokData.payload.secret;
            targetLic.hubUrl = tokData.payload.hubUrl;
            this.state.licenses[targetLic.licenseId] = signCertificate(targetLic, this.authorityKeys);
        }
        if (!licenseId || licenseId === user.licenseId) {
            user.hubToken = tokData.token;
            user.hubTokenId = tokData.payload.tokenId;
            user.hubTokenSecret = tokData.payload.secret;
            user.hubUrl = tokData.payload.hubUrl;
        }
        this._save();

        return {
            ok: true,
            token: tokData.token,
            tokenId: tokData.payload.tokenId,
            accountId: user.userId,
            email: user.email,
            hubUrl: tokData.payload.hubUrl,
            issuedAt: tokData.payload.issuedAt,
            licenseId: targetLic ? targetLic.licenseId : user.licenseId,
            serverName: targetLic ? targetLic.serverName : '',
            user: this._formatUserResponse(user),
        };
    }

    /**
     * Проверить токен владельца/сервера (owk1...), привязать локальную систему (HWID / nodeFingerprint) к конкретному
     * серверу из реестра владельца и выдать подписанные файлы лицензий (базовую на 10 вечных мест и дополнительные временные)
     * для сохранения в папке #system.
     */
    syncByOwnerToken({
        token = '',
        hwid = '',
        nodeFingerprint = '',
        nodePublicKey = '',
        serverId = '',
        canonicalHubUrl = '',
    } = {}) {
        const parsed = parseOwnerAccessToken(token);
        if (!verifyOwnerAccessToken(token, this.authorityKeys.publicKey)) {
            const err = new Error('Подпись токена владельца не прошла криптографическую проверку');
            err.statusCode = 401;
            throw err;
        }

        const { accountId, email, tokenId, secret, hubUrl, licenseId: tokLicenseId } = parsed.payload;
        const user = Object.values(this.state.users).find(
            u => u.userId === accountId || (email && u.email === email.toLowerCase())
        );
        if (!user) {
            const err = new Error('Владелец, указанный в токене, не найден на сервере поддержки');
            err.statusCode = 404;
            throw err;
        }

        // Определяем целевой сервер из реестра серверов владельца
        let targetLic = null;
        if (tokLicenseId && this.state.licenses[tokLicenseId]) {
            targetLic = this.state.licenses[tokLicenseId];
        }
        if (!targetLic) {
            targetLic = Object.values(this.state.licenses).find(
                l => l && l.hubTokenId === tokenId && (l.ownerAccountId === user.userId || l.ownerEmail === user.email)
            ) || null;
        }
        if (!targetLic && user.licenseId && this.state.licenses[user.licenseId]) {
            targetLic = this.state.licenses[user.licenseId];
        }

        const matchesServerToken = Boolean(targetLic?.hubTokenId && targetLic.hubTokenId === tokenId && targetLic.hubTokenSecret === secret);
        const matchesUserToken = Boolean(user.hubTokenId && user.hubTokenId === tokenId && user.hubTokenSecret === secret);
        if (!matchesServerToken && !matchesUserToken) {
            const err = new Error('Токен владельца был отозван или перевыпущен в личном кабинете');
            err.statusCode = 401;
            throw err;
        }

        const targetLicenseId = targetLic ? targetLic.licenseId : user.licenseId;

        // Обновляем привязку оборудования именно к этому серверу из реестра
        const summary = this.issueOrUpdateLicense({
            licenseId: targetLicenseId,
            serverName: targetLic?.serverName || 'Сервер WORK #1',
            hwid: hwid || undefined,
            nodeFingerprint: nodeFingerprint || undefined,
            ownerAccountId: user.userId,
            ownerEmail: user.email,
            customer: {
                name: user.companyName,
                inn: user.inn,
                email: user.email,
                phone: user.phone,
            },
        });

        user.boundNodes ??= [];
        const existingNode = user.boundNodes.find(n => n.hwid === summary.hardware?.hwid);
        if (existingNode) {
            existingNode.nodeFingerprint = nodeFingerprint || existingNode.nodeFingerprint;
            existingNode.serverId = serverId || existingNode.serverId;
            existingNode.lastSyncAt = Date.now();
        }
        else if (hwid || nodeFingerprint) {
            user.boundNodes.push({
                hwid: summary.hardware?.hwid || hwid,
                nodeFingerprint,
                nodePublicKey,
                serverId,
                boundAt: Date.now(),
                lastSyncAt: Date.now(),
            });
        }
        this._save();

        const resolvedHubUrl = String(canonicalHubUrl || user.hubUrl || hubUrl || 'https://work.odant.org').replace(/\/+$/, '');
        return {
            ok: true,
            accountId: user.userId,
            ownerEmail: user.email,
            companyName: user.companyName,
            canonicalHubUrl: resolvedHubUrl,
            licenseId: summary.licenseId,
            baseActivated: summary.baseActivated,
            baseSeats: summary.baseSeats,
            addonSeats: summary.addonSeats,
            totalSeats: summary.totalSeats,
            aiAgentsEnabled: summary.aiAgentsEnabled,
            certificate: summary.certificate,
            licenseFiles: summary.licenseFiles,
            license: summary,
        };
    }

    /**
     * Подписать публичную оферту ODANT-WORK простой электронной подписью (ПЭП) в личном кабинете.
     */
    acceptUserOferta(sessionKeyOrEmail = '', {
        signerName = '',
        position = '',
        companyName = '',
        inn = '',
        phone = '',
    } = {}) {
        const key = String(sessionKeyOrEmail || '').trim();
        let user = Object.values(this.state.users).find(u => u.sessionKey === key || u.email === key.toLowerCase());
        if (!user)
            throw new Error('Пользователь не найден. Пожалуйста, войдите или зарегистрируйтесь в личном кабинете.');

        const now = Date.now();
        if (signerName) user.name = String(signerName).trim();
        if (position) user.position = String(position).trim();
        if (companyName) user.companyName = String(companyName).trim();
        if (inn) user.inn = String(inn).trim();
        if (phone) user.phone = String(phone).trim();

        user.ofertaAccepted = true;
        user.ofertaAcceptedAt = user.ofertaAcceptedAt || now;
        user.ofertaVersion = PUBLIC_OFERTA.version;
        user.ofertaSignerName = String(signerName || user.name || user.companyName).trim();
        user.ofertaSignatureId = user.ofertaSignatureId || ('PEP-' + crypto.randomBytes(4).toString('hex').toUpperCase());

        if (user.licenseId && this.state.licenses[user.licenseId]) {
            const rawLic = this.state.licenses[user.licenseId];
            if (user.companyName) rawLic.customer.name = user.companyName;
            if (user.inn) rawLic.customer.inn = user.inn;
            if (user.phone) rawLic.customer.phone = user.phone;
            this.state.licenses[user.licenseId] = signCertificate(rawLic, this.authorityKeys);
        }

        this._save();
        return this._formatUserResponse(user);
    }

    findUserBySessionKey(sessionKey = '') {
        const key = String(sessionKey || '').trim();
        if (!key)
            return null;
        const user = this._findUser(key);
        if (!user)
            return null;
        return this._formatUserResponse(user);
    }

    listUsers() {
        return Object.values(this.state.users)
            .sort((a, b) => (b.lastLoginAt || 0) - (a.lastLoginAt || 0))
            .map(u => {
                const formatted = this._formatUserResponse(u);
                delete formatted.sessionKey;
                return formatted;
            });
    }

    /**
     * Автоматически отменить резервы франшиз, по которым не оплачен начальный взнос (100 000 ₽) в течение 15 минут.
     */
    _expireStaleReservations(now = Date.now()) {
        let changed = false;
        for (const resv of Object.values(this.state.reservations || {})) {
            if (!resv) continue;
            if (
                resv.status === 'reserved_pending_deposit'
                && !resv.depositPaid
                && resv.depositDeadlineAt
                && now > Number(resv.depositDeadlineAt)
            ) {
                resv.status = 'expired';
                resv.expiredAt = now;
                if (resv.orderId && this.state.orders[resv.orderId] && this.state.orders[resv.orderId].status !== 'paid') {
                    this.state.orders[resv.orderId].status = 'canceled';
                    this.state.orders[resv.orderId].canceledAt = now;
                }
                changed = true;
            }
        }
        if (changed) {
            try { this._save(); } catch { /* ignore */ }
        }
        return changed;
    }

    /**
     * Получить развёрнутую карточку региональной франшизы с таймером 15 минут и 12-месячным графиком погашения.
     */
    getFranchiseSummary(reservationId, now = Date.now()) {
        this._expireStaleReservations(now);
        const resv = this.state.reservations[reservationId];
        if (!resv)
            return null;

        const depositRub = Number(resv.nonRefundableDepositRub || FRANCHISE_PROGRAM.reservationDepositRub || 100_000);
        const totalFeeRub = Number(resv.franchiseFeeRub || 500_000);
        const remainingAfterDeposit = Math.max(0, totalFeeRub - depositRub);

        if (!Array.isArray(resv.paymentSchedule) || resv.paymentSchedule.length !== 12) {
            resv.paymentSchedule = buildFranchisePaymentSchedule({
                remainingRub: remainingAfterDeposit,
                startMs: resv.paidAt || resv.createdAt || now,
                existingSchedule: resv.paymentSchedule || [],
            });
        }

        let nextFound = false;
        let paidMonthsCount = 0;
        let overdueMonthsCount = 0;
        let paidInstallmentsRub = 0;
        let nextInstallment = null;

        const schedule = resv.paymentSchedule.map(inst => {
            const isPaid = inst.status === 'paid';
            if (isPaid) {
                paidMonthsCount += 1;
                paidInstallmentsRub += Number(inst.amountRub || 0);
                return { ...inst, displayStatus: 'paid' };
            }
            const isOverdue = Boolean(resv.depositPaid && inst.dueDate && now > Number(inst.dueDate));
            if (isOverdue) overdueMonthsCount += 1;
            let displayStatus = isOverdue ? 'overdue' : 'scheduled';
            if (!nextFound) {
                nextFound = true;
                if (!isOverdue) displayStatus = 'next';
                nextInstallment = { ...inst, displayStatus };
            }
            return { ...inst, displayStatus };
        });

        const totalPaidRub = (resv.depositPaid ? depositRub : 0) + paidInstallmentsRub;
        const remainingFranchiseFeeRub = Math.max(0, totalFeeRub - totalPaidRub);
        const depositDeadlineAt = Number(resv.depositDeadlineAt || ((resv.createdAt || now) + FRANCHISE_RESERVATION_TTL_MS));
        const depositRemainingSeconds = (!resv.depositPaid && resv.status === 'reserved_pending_deposit')
            ? Math.max(0, Math.floor((depositDeadlineAt - now) / 1000))
            : 0;

        const relatedOrders = Object.values(this.state.orders || {})
            .filter(o => o.reservationId === resv.reservationId && o.status !== 'canceled')
            .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

        return {
            ...resv,
            depositDeadlineAt,
            depositRemainingSeconds,
            paymentSchedule: schedule,
            paidMonthsCount,
            totalMonthsCount: 12,
            overdueMonthsCount,
            paidInstallmentsRub,
            totalPaidRub,
            remainingFranchiseFeeRub,
            nextInstallment,
            orders: relatedOrders,
        };
    }

    /**
     * 1.2 Реестр франшиз пользователя (несколько франшиз в разных регионах, но не более 1 в одном регионе).
     */
    listUserFranchises(userOrKey, now = Date.now()) {
        this._expireStaleReservations(now);
        const user = typeof userOrKey === 'object' ? userOrKey : this._findUser(userOrKey);
        if (!user)
            return [];
        const userEmail = String(user.email || '').toLowerCase();
        return Object.values(this.state.reservations || {})
            .filter(r => r && r.status !== 'canceled' && r.status !== 'expired' && (
                (user.userId && r.ownerAccountId === user.userId)
                || (userEmail && String(r.email || '').toLowerCase() === userEmail)
            ))
            .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
            .map(r => this.getFranchiseSummary(r.reservationId, now));
    }

    /**
     * Список всех франшиз и резервов для Админ-панели (/admin).
     */
    listAllFranchises(now = Date.now()) {
        this._expireStaleReservations(now);
        return Object.values(this.state.reservations || {})
            .filter(Boolean)
            .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
            .map(r => this.getFranchiseSummary(r.reservationId, now));
    }

    /**
     * Создать заказ на оплату очередного ежемесячного платежа (раз в месяц) или досрочное погашение остатка франшизы.
     */
    createFranchiseInstallmentOrder(sessionKeyOrEmail = '', {
        reservationId = '',
        monthNumber = null,
        earlyPayoff = false,
        paymentMethod = 'yookassa',
        companyName = '',
        inn = '',
        returnUrl = '',
    } = {}) {
        this._expireStaleReservations();
        const user = this._findUser(sessionKeyOrEmail);
        const summary = this.getFranchiseSummary(reservationId);
        if (!summary)
            throw new Error(`Франшиза ${reservationId} не найдена`);
        if (summary.status === 'canceled' || summary.status === 'expired')
            throw new Error('Резерв франшизы истёк или был отменён');
        if (!summary.depositPaid)
            throw new Error('Сначала оплатите начальный взнос за резервирование франшизы (100 000 ₽)');

        const unpaid = (summary.paymentSchedule || []).filter(it => it.status !== 'paid');
        if (!unpaid.length || summary.remainingFranchiseFeeRub <= 0)
            throw new Error('Все 12 платежей по данной франшизе уже полностью погашены');

        let targetInstallments = [];
        if (earlyPayoff) {
            targetInstallments = unpaid;
        }
        else if (monthNumber != null) {
            const found = unpaid.find(it => Number(it.monthNumber) === Number(monthNumber));
            if (!found)
                throw new Error(`Платёж №${monthNumber} уже оплачен или не найден`);
            targetInstallments = [found];
        }
        else {
            targetInstallments = [unpaid[0]];
        }

        const amountRub = targetInstallments.reduce((s, it) => s + Number(it.amountRub || 0), 0);
        const monthsList = targetInstallments.map(it => Number(it.monthNumber));
        const now = Date.now();
        const method = String(paymentMethod || 'yookassa').toLowerCase() === 'invoice' ? 'invoice' : 'yookassa';
        const orderId = 'ORD-FI-' + now.toString(36).toUpperCase() + '-' + crypto.randomBytes(2).toString('hex').toUpperCase();
        const invoiceNumber = 'СЧ-FI-' + new Date(now).toISOString().slice(0, 10).replace(/-/g, '') + '-' + orderId.slice(-4);
        const contractNumber = summary.contractNumber || ('ДЛ-FR-' + new Date(now).getFullYear() + '-' + summary.reservationId.slice(-6));

        const title = earlyPayoff
            ? `Досрочное погашение остатка паушального взноса по франшизе ODANT-WORK (${summary.regionName}, платежи №${monthsList.join(', ')})`
            : `Ежемесячный платёж №${monthsList[0]}/12 по графику погашения франшизы ODANT-WORK (${summary.regionName})`;

        const order = {
            orderId,
            ownerAccountId: summary.ownerAccountId || user?.userId || '',
            kind: 'franchise_installment',
            reservationId: summary.reservationId,
            licenseId: summary.reservationId,
            regionCode: summary.regionCode,
            regionName: summary.regionName,
            earlyPayoff: Boolean(earlyPayoff),
            installmentMonths: monthsList,
            tierName: earlyPayoff
                ? `Досрочное погашение франшизы (${summary.regionName})`
                : `Платёж №${monthsList[0]}/12 · Франшиза (${summary.regionName})`,
            addonSeats: 1,
            years: 1,
            amountRub,
            paymentMethod: method,
            invoiceNumber,
            contractNumber,
            invoiceUrl: `/api/orders/${encodeURIComponent(orderId)}/invoice`,
            items: [
                {
                    title,
                    quantity: 1,
                    unitPriceRub: amountRub,
                    totalRub: amountRub,
                },
            ],
            customer: {
                name: companyName || summary.companyName || user?.companyName || user?.email || 'Партнёр ODANT-WORK',
                inn: inn || summary.inn || user?.inn || '',
                email: summary.email || user?.email || 'franchise@odant.org',
                phone: summary.phone || user?.phone || '',
            },
            status: method === 'invoice' ? 'awaiting_invoice' : 'pending',
            paymentId: '',
            confirmationUrl: method === 'invoice' ? `/api/orders/${encodeURIComponent(orderId)}/invoice` : '',
            returnUrl: returnUrl || 'https://work.odant.org/#addons',
            createdAt: now,
            paidAt: null,
        };

        this.state.orders[orderId] = order;
        this._save();
        return {
            ok: true,
            order,
            franchise: this.getFranchiseSummary(summary.reservationId),
            user: user ? this._formatUserResponse(user) : null,
        };
    }

    /**
     * Зачесть оплату ежемесячного платежа (или полного остатка) по графику франшизы из Админ-панели (/admin).
     */
    adminConfirmFranchiseInstallment(reservationId, {
        monthNumber = null,
        earlyPayoff = false,
        paymentOrderNumber = '',
    } = {}) {
        const resv = this.state.reservations[reservationId];
        if (!resv)
            throw new Error(`Франшиза ${reservationId} не найдена`);
        if (!resv.depositPaid && !earlyPayoff && monthNumber == null) {
            if (resv.orderId && this.state.orders[resv.orderId]) {
                return this.confirmInvoicePayment(resv.orderId, { paymentOrderNumber });
            }
        }
        const created = this.createFranchiseInstallmentOrder(resv.ownerAccountId || resv.email, {
            reservationId,
            monthNumber,
            earlyPayoff,
            paymentMethod: 'invoice',
        });
        return this.confirmInvoicePayment(created.order.orderId, {
            paymentOrderNumber: paymentOrderNumber || `ADM-FI-${Date.now()}`,
        });
    }

    /**
     * Получить статус квоты и вакантных франшиз по региону (макс. число партнёров пропорционально населению).
     */
    getRegionPartnerQuotaStatus(regionCode = 'RU-SVE', customPopulationMillions = null, options = {}) {
        this._expireStaleReservations();
        const info = calculateFranchiseFee(regionCode, customPopulationMillions);
        const ignoreResId = options?.ignoreReservationId || '';
        const existingInRegion = Object.values(this.state.partners).filter(
            p => p.regionCode === info.regionCode && p.status !== 'revoked'
        );
        const reservedInRegion = Object.values(this.state.reservations || {}).filter(
            r => r.regionCode === info.regionCode
                && r.status !== 'canceled'
                && r.status !== 'expired'
                && !r.convertedToPartnerId
                && r.reservationId !== ignoreResId
        );
        const occupied = existingInRegion.length + reservedInRegion.length;
        const vacantFranchises = Math.max(0, info.maxPartnersQuota - occupied);
        return {
            ...info,
            activePartnersCount: existingInRegion.length,
            reservedFranchisesCount: reservedInRegion.length,
            occupiedFranchisesCount: occupied,
            availablePartnerSlots: vacantFranchises,
            vacantFranchises,
        };
    }

    /**
     * Зарезервировать региональную франшизу с выставлением счёта ЮKassa на невозвратный залог 100 000 ₽ (таймер 15 минут).
     * Пользователь может резервировать несколько франшиз в разных регионах, но не более 1 в одном регионе.
     * Полный паушальный взнос (500 000 ₽ × индекс региона) погашается по помесячному графику в течение 1 года (12 мес.).
     */
    reserveFranchiseSlot({
        regionCode = 'RU-SVE',
        ownerAccountId = '',
        companyName = '',
        inn = '',
        email = '',
        phone = '',
        contactPerson = '',
        depositTtlMs = FRANCHISE_RESERVATION_TTL_MS,
        returnUrl = '',
    } = {}) {
        const now = Date.now();
        this._expireStaleReservations(now);
        const effCompanyName = String(companyName || email || 'Партнёр ODANT-WORK').trim();
        const cleanEmail = String(email || '').trim().toLowerCase();
        const cleanOwnerId = String(ownerAccountId || '').trim();

        const quotaStatus = this.getRegionPartnerQuotaStatus(regionCode);

        // Проверка ограничения 1.2.1: более 1 франшизы в одном регионе одному пользователю резервировать нельзя
        if (cleanOwnerId || cleanEmail) {
            const duplicateResv = Object.values(this.state.reservations || {}).find(r =>
                r
                && r.regionCode === quotaStatus.regionCode
                && r.status !== 'canceled'
                && r.status !== 'expired'
                && (
                    (cleanOwnerId && r.ownerAccountId === cleanOwnerId)
                    || (cleanEmail && String(r.email || '').toLowerCase() === cleanEmail)
                )
            );
            const duplicatePartner = Object.values(this.state.partners || {}).find(p =>
                p
                && p.regionCode === quotaStatus.regionCode
                && p.status !== 'revoked'
                && (
                    (cleanOwnerId && p.ownerAccountId === cleanOwnerId)
                    || (cleanEmail && String(p.email || '').toLowerCase() === cleanEmail)
                )
            );
            if (duplicateResv || duplicatePartner) {
                throw new Error(
                    `В регионе «${quotaStatus.regionName}» у вас уже есть зарезервированная или действующая франшиза `
                    + `(нельзя резервировать более 1 франшизы в одном регионе). Вы можете выбрать любой другой регион.`
                );
            }
        }

        if (quotaStatus.vacantFranchises <= 0) {
            throw new Error(
                `В регионе «${quotaStatus.regionName}» нет вакантных франшиз `
                + `(занято ${quotaStatus.occupiedFranchisesCount} из ${quotaStatus.maxPartnersQuota}, пропорционально населению ${quotaStatus.populationMillions} млн чел.)`
            );
        }

        const reservationId = 'RES-' + quotaStatus.regionCode.replace(/^RU-/, '') + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();
        const depositRub = FRANCHISE_PROGRAM.reservationDepositRub;
        const remainingRub = Math.max(0, quotaStatus.franchiseFeeRub - depositRub);
        const ttlMs = Number(depositTtlMs) > 0 ? Number(depositTtlMs) : FRANCHISE_RESERVATION_TTL_MS;
        const depositDeadlineAt = now + ttlMs;
        const orderId = 'ORD-FR-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(2).toString('hex').toUpperCase();
        const invoiceNumber = 'СЧ-FR-' + new Date(now).toISOString().slice(0, 10).replace(/-/g, '') + '-' + orderId.slice(-4);
        const contractNumber = 'ДЛ-FR-' + new Date(now).getFullYear() + '-' + orderId.slice(-6);

        const reservation = {
            reservationId,
            orderId,
            ownerAccountId: cleanOwnerId,
            regionCode: quotaStatus.regionCode,
            regionName: quotaStatus.regionName,
            district: quotaStatus.district,
            companyName: effCompanyName,
            inn: String(inn || '').trim(),
            email: String(email || 'franchise@odant.org').trim(),
            phone: String(phone || '').trim(),
            contactPerson: String(contactPerson || '').trim(),
            franchiseFeeRub: quotaStatus.franchiseFeeRub,
            nonRefundableDepositRub: depositRub,
            paidInstallmentsRub: 0,
            totalPaidRub: 0,
            remainingFranchiseFeeRub: remainingRub,
            fullPaymentPeriodMonths: FRANCHISE_PROGRAM.fullPaymentPeriodMonths,
            fullPaymentDeadlineAt: now + 365 * 24 * 3600_000,
            depositDeadlineAt,
            paymentSchedule: buildFranchisePaymentSchedule({
                remainingRub,
                startMs: now,
            }),
            status: 'reserved_pending_deposit',
            depositPaid: false,
            createdAt: now,
            expiresAt: now + 365 * 24 * 3600_000,
        };

        const order = {
            orderId,
            ownerAccountId: cleanOwnerId,
            kind: 'franchise_reservation',
            reservationId,
            licenseId: reservationId,
            regionCode: quotaStatus.regionCode,
            regionName: quotaStatus.regionName,
            tierName: `Начальный взнос за резерв франшизы (${quotaStatus.regionName})`,
            addonSeats: 1,
            years: 1,
            amountRub: depositRub,
            franchiseFeeRub: quotaStatus.franchiseFeeRub,
            depositDeadlineAt,
            invoiceNumber,
            contractNumber,
            invoiceUrl: `/api/orders/${encodeURIComponent(orderId)}/invoice`,
            items: [
                {
                    title: `Начальный взнос (залог) за резервирование региональной франшизы ODANT-WORK (${quotaStatus.regionName}, паушальный взнос ${quotaStatus.franchiseFeeRub.toLocaleString('ru-RU')} ₽, график погашения остатка — 12 ежемесячных платежей)`,
                    quantity: 1,
                    unitPriceRub: depositRub,
                    totalRub: depositRub,
                },
            ],
            customer: {
                name: reservation.companyName,
                inn: reservation.inn,
                email: reservation.email,
                phone: reservation.phone,
            },
            status: 'pending',
            paymentId: '',
            confirmationUrl: '',
            returnUrl: returnUrl || 'https://work.odant.org/#addons',
            createdAt: now,
            paidAt: null,
        };

        this.state.reservations[reservationId] = reservation;
        this.state.orders[orderId] = order;
        this._save();

        return {
            reservation: this.getFranchiseSummary(reservationId, now),
            order,
            regionQuota: this.getRegionPartnerQuotaStatus(quotaStatus.regionCode),
        };
    }

    /**
     * Обновить способ оплаты и реквизиты юрлица для существующего заказа из Личного кабинета (и запомнить реквизиты в ЛК).
     */
    prepareOrderPayment(orderId, {
        paymentMethod = 'yookassa',
        companyName = '',
        inn = '',
        kpp = '',
        legalAddress = '',
        signerName = '',
        signerPosition = '',
        bankName = '',
        bik = '',
        bankAccount = '',
        corrAccount = '',
        phone = '',
    } = {}) {
        const order = this.state.orders[orderId];
        if (!order)
            throw new Error(`Заказ ${orderId} не найден`);
        order.paymentMethod = paymentMethod === 'invoice' ? 'invoice' : 'yookassa';
        order.customer = order.customer || {};
        const cleanComp = (companyName && !String(companyName).includes('@')) ? String(companyName).trim() : '';
        if (cleanComp) order.customer.name = cleanComp;
        if (inn) order.customer.inn = String(inn).trim();
        if (kpp !== undefined && kpp !== '') order.customer.kpp = String(kpp).trim();
        if (legalAddress !== undefined && legalAddress !== '') order.customer.legalAddress = String(legalAddress).trim();
        if (signerName !== undefined && signerName !== '') order.customer.signerName = String(signerName).trim();
        if (signerPosition !== undefined && signerPosition !== '') order.customer.signerPosition = String(signerPosition).trim();
        if (bankName !== undefined && bankName !== '') order.customer.bankName = String(bankName).trim();
        if (bik !== undefined && bik !== '') order.customer.bik = String(bik).trim();
        if (bankAccount !== undefined && bankAccount !== '') order.customer.bankAccount = String(bankAccount).trim();
        if (corrAccount !== undefined && corrAccount !== '') order.customer.corrAccount = String(corrAccount).trim();
        if (phone !== undefined && phone !== '') order.customer.phone = String(phone).trim();
        if (!order.invoiceNumber) {
            order.invoiceNumber = 'СЧ-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + orderId.slice(-4);
        }
        if (!order.contractNumber) {
            order.contractNumber = 'ДЛ-' + new Date().getFullYear() + '-' + orderId.slice(-6);
        }
        if (!order.invoiceUrl) {
            order.invoiceUrl = `/api/orders/${encodeURIComponent(orderId)}/invoice`;
        }
        if (order.reservationId && this.state.reservations[order.reservationId]) {
            if (cleanComp) this.state.reservations[order.reservationId].companyName = cleanComp;
            if (inn) this.state.reservations[order.reservationId].inn = String(inn).trim();
        }
        if (order.ownerAccountId) {
            const u = Object.values(this.state.users).find(usr => usr.userId === order.ownerAccountId);
            if (u) {
                if (cleanComp) u.companyName = cleanComp;
                if (inn) u.inn = String(inn).trim();
                if (kpp) u.kpp = String(kpp).trim();
                if (legalAddress) u.legalAddress = String(legalAddress).trim();
                if (signerName) u.signerName = String(signerName).trim();
                if (signerPosition) {
                    u.signerPosition = String(signerPosition).trim();
                    u.position = u.signerPosition;
                }
                if (bankName) u.bankName = String(bankName).trim();
                if (bik) u.bik = String(bik).trim();
                if (bankAccount) u.bankAccount = String(bankAccount).trim();
                if (corrAccount) u.corrAccount = String(corrAccount).trim();
                if (phone) u.phone = String(phone).trim();
            }
        }
        this._save();
        return order;
    }

    /**
     * Отменить резерв франшизы (до оплаты залога — пользователем, либо в любой момент — администратором).
     */
    cancelFranchiseReservation(reservationId, { byAdmin = false } = {}) {
        const resv = this.state.reservations[reservationId];
        if (!resv)
            throw new Error(`Франшиза ${reservationId} не найдена`);
        if (resv.depositPaid && !byAdmin)
            throw new Error('Залог по франшизе уже оплачен. Для расторжения обратитесь к администратору.');
        const now = Date.now();
        resv.status = 'canceled';
        resv.canceledAt = now;
        for (const ord of Object.values(this.state.orders || {})) {
            if (ord.reservationId === reservationId && ord.status !== 'paid') {
                ord.status = 'canceled';
                ord.canceledAt = now;
            }
        }
        if (resv.convertedToPartnerId && this.state.partners[resv.convertedToPartnerId] && byAdmin) {
            this.state.partners[resv.convertedToPartnerId].status = 'revoked';
        }
        this._save();
        return {
            ok: true,
            reservationId,
            regionQuota: this.getRegionPartnerQuotaStatus(resv.regionCode),
        };
    }

    /**
     * Зарегистрировать регионального партнёра-франчайзи с контролем региональной квоты (по населению)
     * и расчётом фиксированного паушального взноса (пропорционально экономике региона).
     * Если передан reservationId — конвертирует существующий резерв франшизы в действующего партнёра.
     */
    registerPartner({
        partnerId = '',
        reservationId = '',
        companyName = '',
        inn = '',
        regionCode = 'RU-SVE',
        populationMillions = null,
        email = '',
        phone = '',
        contactPerson = '',
        annualSalesRub = 0,
    } = {}) {
        const resv = reservationId ? this.state.reservations[reservationId] : null;
        if (reservationId && !resv)
            throw new Error(`Резерв франшизы ${reservationId} не найден`);
        if (resv?.convertedToPartnerId && this.state.partners[resv.convertedToPartnerId])
            return this.getPartnerSummary(resv.convertedToPartnerId);

        const effCompany = String(companyName || resv?.companyName || '').trim();
        const effRegion = String(regionCode || resv?.regionCode || 'RU-SVE').trim();
        const effInn = String(inn || resv?.inn || '').trim();
        const effEmail = String(email || resv?.email || '').trim();
        const effPhone = String(phone || resv?.phone || '').trim();
        const effContact = String(contactPerson || resv?.contactPerson || '').trim();

        if (!effCompany)
            throw new Error('Укажите наименование компании-партнёра');

        const quotaStatus = this.getRegionPartnerQuotaStatus(effRegion, populationMillions, {
            ignoreReservationId: resv?.reservationId || '',
        });
        const existing = partnerId ? this.state.partners[partnerId] : null;

        if (!existing && quotaStatus.availablePartnerSlots <= 0) {
            throw new Error(
                `В регионе «${quotaStatus.regionName}» исчерпана квота партнёров `
                + `(${quotaStatus.activePartnersCount} из ${quotaStatus.maxPartnersQuota}, `
                + `пропорционально населению ${quotaStatus.populationMillions} млн чел.)`
            );
        }

        const id = existing?.partnerId || partnerId || ('PRT-' + quotaStatus.regionCode.replace(/^RU-/, '') + '-' + crypto.randomBytes(3).toString('hex').toUpperCase());
        const discountInfo = calculatePartnerDiscount(annualSalesRub ?? existing?.annualSalesRub ?? 0);
        const now = Date.now();

        const partner = {
            partnerId: id,
            reservationId: resv?.reservationId || existing?.reservationId || '',
            companyName: effCompany,
            inn: effInn || existing?.inn || '',
            regionCode: quotaStatus.regionCode,
            regionName: quotaStatus.regionName,
            district: quotaStatus.district,
            populationMillions: quotaStatus.populationMillions,
            maxRegionPartnersQuota: quotaStatus.maxPartnersQuota,
            economicIndex: quotaStatus.economicIndex,
            franchiseFeeRub: quotaStatus.franchiseFeeRub,
            email: effEmail || existing?.email || '',
            phone: effPhone || existing?.phone || '',
            contactPerson: effContact || existing?.contactPerson || '',
            annualSalesRub: discountInfo.annualSalesRub,
            discountPercent: discountInfo.discountPercent,
            statusLevel: discountInfo.statusLevel,
            certifiedSpecialists: Array.isArray(existing?.certifiedSpecialists) ? existing.certifiedSpecialists : [],
            certifiedStatus: Boolean(existing?.certifiedStatus),
            status: existing?.status || 'active',
            createdAt: existing?.createdAt || now,
            updatedAt: now,
        };

        this.state.partners[id] = partner;
        if (resv) {
            resv.convertedToPartnerId = id;
            resv.status = 'converted';
            resv.convertedAt = now;
            resv.depositPaid = true;
            if (resv.orderId && this.state.orders[resv.orderId] && this.state.orders[resv.orderId].status === 'pending') {
                this.state.orders[resv.orderId].status = 'paid';
                this.state.orders[resv.orderId].paidAt = now;
            }
        }
        this._save();
        return this.getPartnerSummary(id);
    }

    /**
     * Зафиксировать продажу партнёра и пересчитать партнёрскую скидку (от 10% до 50% пропорционально годовому объёму).
     */
    recordPartnerSale(partnerId, saleAmountRub = 0) {
        const p = this.state.partners[partnerId];
        if (!p)
            throw new Error(`Партнёр ${partnerId} не найден`);
        const added = Math.max(0, Number(saleAmountRub || 0));
        const newSales = Number(p.annualSalesRub || 0) + added;
        const discountInfo = calculatePartnerDiscount(newSales);
        p.annualSalesRub = discountInfo.annualSalesRub;
        p.discountPercent = discountInfo.discountPercent;
        p.statusLevel = discountInfo.statusLevel;
        p.updatedAt = Date.now();
        this._save();
        return this.getPartnerSummary(partnerId);
    }

    /**
     * Провести аттестацию и выпустить сертификат специалиста партнёра по программе обучения WORK.
     */
    certifyPartnerSpecialist({
        partnerId,
        specialistName = '',
        email = '',
        specialistEmail = '',
        trackId = '',
        trackCode = '',
        score = undefined,
        examScore = undefined,
    } = {}) {
        const p = this.state.partners[partnerId];
        if (!p)
            throw new Error(`Партнёр ${partnerId} не найден`);
        if (!specialistName)
            throw new Error('Укажите ФИО аттестуемого специалиста');

        const requestedTrack = String(trackId || trackCode || '').trim();
        let track = null;
        if (!requestedTrack || requestedTrack === 'next' || requestedTrack === 'TRK-PAK-HW') {
            const passedIds = new Set((p.certifiedSpecialists || []).map(c => c.trackId));
            track = PARTNER_TRAINING_TRACKS.find(t => t.requiredForFranchise && !passedIds.has(t.id))
                || PARTNER_TRAINING_TRACKS.find(t => !passedIds.has(t.id))
                || PARTNER_TRAINING_TRACKS[0];
        }
        else {
            track = PARTNER_TRAINING_TRACKS.find(t => t.id === requestedTrack || t.code === requestedTrack);
        }
        if (!track)
            throw new Error(`Учебный курс ${requestedTrack} не найден в программе обучения`);

        const numericScore = Number(score ?? examScore ?? 100);
        if (numericScore < track.passScore) {
            throw new Error(
                `Балл аттестации (${numericScore}) ниже проходного порога (${track.passScore}) для курса «${track.title}»`
            );
        }

        const certId = `${track.code}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
        const now = Date.now();
        const cert = {
            certificateId: certId,
            partnerId: p.partnerId,
            companyName: p.companyName,
            regionCode: p.regionCode,
            specialistName: String(specialistName).trim(),
            email: String(email || specialistEmail || '').trim(),
            trackId: track.id,
            trackCode: track.code,
            trackTitle: track.title,
            hours: track.hours,
            score: numericScore,
            issuedAt: now,
            validUntil: now + 2 * ONE_YEAR_MS,
        };

        this.state.certificates[certId] = cert;
        p.certifiedSpecialists ??= [];
        p.certifiedSpecialists.push(cert);

        // Проверяем, закрыты ли все обязательные треки для статуса сертифицированного франчайзи
        const requiredTrackIds = PARTNER_TRAINING_TRACKS.filter(t => t.requiredForFranchise).map(t => t.id);
        const passedTrackIds = new Set(p.certifiedSpecialists.map(c => c.trackId));
        p.certifiedStatus = requiredTrackIds.every(reqId => passedTrackIds.has(reqId));
        p.updatedAt = now;

        this._save();
        return {
            certificate: cert,
            partner: this.getPartnerSummary(p.partnerId),
        };
    }

    getPartnerSummary(partnerId) {
        const p = this.state.partners[partnerId];
        if (!p)
            return null;
        const discountInfo = calculatePartnerDiscount(p.annualSalesRub);
        const regionQuota = this.getRegionPartnerQuotaStatus(p.regionCode, p.populationMillions);
        return {
            ...p,
            discountPercent: discountInfo.discountPercent,
            statusLevel: discountInfo.statusLevel,
            nextTargetSalesRub: discountInfo.nextTargetSalesRub,
            regionQuota: {
                populationMillions: regionQuota.populationMillions,
                maxPartnersQuota: regionQuota.maxPartnersQuota,
                activePartnersCount: regionQuota.activePartnersCount,
                availablePartnerSlots: regionQuota.availablePartnerSlots,
            },
        };
    }

    listPartners({ regionCode = '' } = {}) {
        const list = Object.keys(this.state.partners).map(id => this.getPartnerSummary(id));
        if (regionCode)
            return list.filter(p => p.regionCode === regionCode);
        return list;
    }

    listRegionsWithQuotas() {
        return REGIONS_CATALOG.map(r => this.getRegionPartnerQuotaStatus(r.code));
    }
}
