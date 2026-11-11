/**
 * HTTP-сервер приложения work.odant.org:
 *  - GET  /                                — Витрина ODANT-WORK (платформа, ИИ-агенты, тарифы, заказ, франшиза, поддержка);
 *  - GET  /favicon.ico, /assets/*          — Логотип ODANT, стили и скрипт витрины, контуры субъектов РФ;
 *  - GET  /api/catalog                     — Спецификация комплекса (AMD Ryzen™ AI Max+ PRO 495, 192 ГБ, 4 ТБ) и тарифы Start/Business/Enterprise;
 *  - POST /api/quote                       — Расчёт стоимости заказа;
 *  - POST /api/license/issue               — Выпуск базовой лицензии ПАК (5 вечных мест + 1 год поддержки);
 *  - POST /api/license/sync                — Онлайн-синхронизация лицензии с ПАК клиента (привязка HWID + node-key.json);
 *  - GET  /api/license/:id                 — Статус и сертификат лицензии;
 *  - POST /api/orders/checkout             — Создание заказа и платежа ЮKassa;
 *  - POST /api/payments/yookassa/webhook   — Webhook уведомлений ЮKassa (payment.succeeded / payment.canceled);
 *  - GET  /pay/sandbox/:orderId            — Встроенная страница оплаты песочницы ЮKassa;
 *  - POST /api/bots/max/webhook            — Webhook бота поддержки в мессенджере MAX;
 *  - POST /api/bots/telegram/webhook       — Webhook бота поддержки в Telegram;
 *  - POST /api/bots/vk/webhook             — Webhook бота поддержки в VK;
 *  - POST /api/tickets/:id/reply           — Ответ инженера поддержки клиенту с отправкой в MAX / Telegram / VK;
 *  - GET  /api/admin/overview              — Сводка по лицензиям, заказам и тикетам.
 */
import http from 'node:http';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
    PAK_PRODUCT,
    BASE_LICENSE_PRODUCT,
    ADDITIONAL_PRODUCTS,
    SLA_TIERS,
    SEAT_VOLUME_DISCOUNTS,
    calculateSeatVolumeDiscount,
    calculateOrderQuote,
    FRANCHISE_PROGRAM,
    REGIONS_CATALOG,
    PARTNER_TRAINING_TRACKS,
    calculateFranchiseFee,
    calculatePartnerDiscount,
    calculatePartnerEconomics,
    calculateRegionPartnerQuota,
    PUBLIC_OFERTA,
} from './catalog.js';
import { LicenseStore } from './store.js';
import { YooKassaService } from './yookassa.js';
import { SupportBotsHub } from './bots.js';
import { LicenseServerAiAgent } from './agent.js';
import { renderLandingPage, renderSandboxPaymentPage } from './landing.js';
import { renderAdminPage } from './admin.js';

const DEFAULT_DATA_DIR = fileURLToPath(new URL('../data', import.meta.url));

async function readJsonBody(req, maxBytes = 1024 * 1024) {
    const chunks = [];
    let size = 0;
    for await (const ch of req) {
        size += ch.length;
        if (size > maxBytes)
            throw new Error('Request body too large');
        chunks.push(ch);
    }
    const raw = Buffer.concat(chunks).toString('utf8').trim();
    if (!raw)
        return {};
    return JSON.parse(raw);
}

function sendJson(res, status, data) {
    const body = JSON.stringify(data, null, 2);
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    res.end(body);
}

const ASSETS_DIR = new URL('../assets/', import.meta.url);
const STATIC_ASSETS = Object.freeze({
    '/favicon.ico': { file: 'odant-logo.png', type: 'image/png' },
    '/assets/odant-logo.png': { file: 'odant-logo.png', type: 'image/png' },
    '/assets/russia-regions.json': { file: 'russia-regions.json', type: 'application/json; charset=utf-8' },
    '/assets/landing.css': { file: 'landing.css', type: 'text/css; charset=utf-8' },
    '/assets/landing.js': { file: 'landing.js', type: 'text/javascript; charset=utf-8' },
    '/assets/admin.js': { file: 'admin.js', type: 'text/javascript; charset=utf-8' },
});
const assetCache = new Map();
let assetVersionCache = '';

/** Версия статики для сброса кэша браузера: короткий хеш стилей и скриптов витрины/админки. */
function assetVersion() {
    if (assetVersionCache && !process.env.WORK_DEV)
        return assetVersionCache;
    const hash = crypto.createHash('sha1');
    for (const file of ['landing.css', 'landing.js', 'admin.js'])
        hash.update(fs.readFileSync(new URL(file, ASSETS_DIR)));
    assetVersionCache = hash.digest('hex').slice(0, 10);
    return assetVersionCache;
}

function sendStaticAsset(res, asset) {
    let body = assetCache.get(asset.file);
    if (!body) {
        body = fs.readFileSync(new URL(asset.file, ASSETS_DIR));
        if (!process.env.WORK_DEV)
            assetCache.set(asset.file, body);
    }
    res.writeHead(200, {
        'Content-Type': asset.type,
        'Cache-Control': process.env.WORK_DEV ? 'no-cache' : 'public, max-age=3600',
    });
    res.end(body);
}

function sendHtml(res, status, html) {
    res.writeHead(status, {
        'Content-Type': 'text/html; charset=utf-8',
    });
    res.end(html);
}

export function createLicenseServerApp(options = {}) {
    const store = options.store || new LicenseStore({
        dataDir: options.dataDir || DEFAULT_DATA_DIR,
        adminLogin: options.adminLogin,
        adminPassword: options.adminPassword,
    });
    let bots = null;
    const yookassa = options.yookassa || new YooKassaService({
        store,
        shopId: options.yookassaShopId,
        secretKey: options.yookassaSecretKey,
        publicOrigin: options.publicOrigin || 'https://work.odant.org',
        fetchImpl: options.fetchImpl,
        onOrderPaid: async (order, license) => {
            await bots?.notifyLicenseOrderPaid(order, license);
        },
    });
    bots = options.bots || new SupportBotsHub({
        store,
        yookassa,
        maxBotSecret: options.maxBotSecret,
        telegramBotSecret: options.telegramBotSecret,
        vkBotSecret: options.vkBotSecret,
        vkConfirmationCode: options.vkConfirmationCode,
        publicOrigin: options.publicOrigin || 'https://work.odant.org',
        fetchImpl: options.fetchImpl,
    });
    const agent = options.agent || new LicenseServerAiAgent({
        store,
        yookassa,
        fetchImpl: options.fetchImpl,
    });

    function extractBearerToken(req, body = null, url = null) {
        const authHeader = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
        const xAdmin = String(req.headers['x-admin-token'] || req.headers['x-admin-key'] || '').trim();
        return authHeader || xAdmin || body?.adminToken || body?.sessionKey || url?.searchParams?.get('sessionKey') || '';
    }

    function ensureCustomerOferta(req, body = {}) {
        const tok = extractBearerToken(req, body);
        let user = store.findUserBySessionKey(tok);
        if (user && user.ofertaAccepted)
            return user;

        // Если в запросе переданы реквизиты и явное согласие с офертой (ofertaAccepted: true) — регистрируем и подписываем ПЭП
        if (body.ofertaAccepted === true) {
            const email = body.email || body.customer?.email || 'client@odant-work.ru';
            const companyName = body.companyName || body.customer?.name || 'Организация ODANT-WORK';
            const inn = body.inn || body.customer?.inn || '';
            user = store.registerOrLoginUser({
                email,
                companyName,
                inn,
                name: body.signerName || body.contactPerson || companyName,
                licenseId: body.licenseId || '',
                ofertaAccepted: true,
            });
            return user;
        }

        // Если это прямой M2M-запрос с привязанного ПАК WORK (переданы hwid и nodeFingerprint)
        if (body.hwid && body.nodeFingerprint)
            return { hwid: body.hwid, ofertaAccepted: true };

        const err = new Error('Любые действия по заказам, оплате и резервированию франшизы доступны только после регистрации и подписания публичной оферты ODANT-WORK (ПЭП)');
        err.statusCode = 403;
        err.code = 'OFERTA_REQUIRED';
        throw err;
    }

    async function handler(req, res) {
        try {
            if (req.method === 'OPTIONS') {
                res.writeHead(204, {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Token, X-Admin-Key',
                });
                res.end();
                return;
            }

            const hostHeader = req.headers.host || 'work.odant.org';
            const proto = req.headers['x-forwarded-proto'] || 'http';
            const reqOrigin = `${proto}://${hostHeader}`;
            const url = new URL(req.url || '/', reqOrigin);
            const pathname = url.pathname;

            // 1. Главная страница публичной витрины work.odant.org (без админки)
            if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
                return sendHtml(res, 200, renderLandingPage({
                    publicKey: store.authorityKeys.publicKey,
                    regions: store.listRegionsWithQuotas(),
                    assetVersion: assetVersion(),
                }));
            }

            // 1.0 Отдельная страница защищённой админ-панели (/admin)
            if (req.method === 'GET' && (pathname === '/admin' || pathname === '/admin/')) {
                return sendHtml(res, 200, renderAdminPage({
                    publicKey: store.authorityKeys.publicKey,
                    assetVersion: assetVersion(),
                }));
            }

            // 1.1 Статика: логотип ODANT, стили, клиентские скрипты и контуры субъектов РФ
            if (req.method === 'GET' && STATIC_ASSETS[pathname]) {
                return sendStaticAsset(res, STATIC_ASSETS[pathname]);
            }

            // 2. Каталог ПАК, отдельной базовой лицензии (4 млн ₽), тарифов SLA, прочих товаров, партнёрской франшизы и оферты
            if (req.method === 'GET' && pathname === '/api/catalog') {
                return sendJson(res, 200, {
                    product: PAK_PRODUCT,
                    baseLicenseProduct: BASE_LICENSE_PRODUCT,
                    additionalProducts: ADDITIONAL_PRODUCTS,
                    tiers: Object.values(SLA_TIERS),
                    volumeDiscounts: SEAT_VOLUME_DISCOUNTS,
                    franchiseProgram: FRANCHISE_PROGRAM,
                    regions: store.listRegionsWithQuotas(),
                    trainingTracks: PARTNER_TRAINING_TRACKS,
                    oferta: PUBLIC_OFERTA,
                    authorityPublicKey: store.authorityKeys.publicKey,
                });
            }

            if (req.method === 'GET' && pathname === '/api/oferta') {
                return sendJson(res, 200, PUBLIC_OFERTA);
            }

            // 2.0 Вход / регистрация пользователя и подписание публичной оферты ПЭП
            if (req.method === 'POST' && (pathname === '/api/auth/login' || pathname === '/api/auth/register')) {
                const body = await readJsonBody(req);
                const user = store.registerOrLoginUser({
                    ...body,
                    hubUrl: body.hubUrl || reqOrigin,
                });
                return sendJson(res, 200, user);
            }

            // 2.0.1 Генерация или перевыпуск токена владельца (с зашитым URL сервера поддержки) в личном кабинете
            if (req.method === 'POST' && pathname === '/api/cabinet/token') {
                const body = await readJsonBody(req);
                const key = extractBearerToken(req, body, url) || body.email || body.accountId || '';
                const result = store.generateUserHubToken(key, {
                    hubUrl: body.hubUrl || reqOrigin,
                });
                return sendJson(res, 200, result);
            }

            if (req.method === 'POST' && pathname === '/api/auth/accept-oferta') {
                const body = await readJsonBody(req);
                const key = extractBearerToken(req, body, url) || body.email || '';
                const user = store.acceptUserOferta(key, body);
                return sendJson(res, 200, user);
            }

            if (req.method === 'GET' && pathname === '/api/auth/me') {
                const key = extractBearerToken(req, null, url);
                const user = store.findUserBySessionKey(key);
                if (!user)
                    return sendJson(res, 401, { authenticated: false });
                return sendJson(res, 200, { authenticated: true, user });
            }

            // 2.1 Партнёрская программа: справочник регионов с квотами по населению, шкала скидок 10%-50% и курсы сертификации
            if (req.method === 'GET' && pathname === '/api/partners/program') {
                return sendJson(res, 200, {
                    franchiseProgram: FRANCHISE_PROGRAM,
                    regions: store.listRegionsWithQuotas(),
                    trainingTracks: PARTNER_TRAINING_TRACKS,
                    partners: store.listPartners(),
                });
            }

            // 2.2 Калькулятор экономики партнёра (стоимость франшизы по региону, квота по населению, скидка 10%-50% от объёма продаж)
            if (req.method === 'POST' && pathname === '/api/partners/calc') {
                const body = await readJsonBody(req);
                const econ = calculatePartnerEconomics(body);
                const quota = store.getRegionPartnerQuotaStatus(body.regionCode || 'RU-SVE', body.populationMillions);
                return sendJson(res, 200, { ...econ, regionQuota: quota });
            }

            // 2.3 Регистрация регионального партнёра-франчайзи (с проверкой квоты партнёров пропорционально населению региона)
            if (req.method === 'POST' && pathname === '/api/partners/register') {
                const body = await readJsonBody(req);
                const partner = store.registerPartner(body);
                return sendJson(res, 200, partner);
            }

            // 2.4 Прохождение аттестации и выдача сертификата специалиста партнёра
            if (req.method === 'POST' && pathname === '/api/partners/certify') {
                const body = await readJsonBody(req);
                const result = store.certifyPartnerSpecialist(body);
                return sendJson(res, 200, result);
            }

            // 2.5 Выдача и привязка лицензии ПАК самим партнёром (с 1 годом гарантии на оборудование и доп. услугами партнёра)
            if (req.method === 'POST' && pathname === '/api/partners/issue-license') {
                const body = await readJsonBody(req);
                const result = store.partnerIssueLicense(body);
                return sendJson(res, 200, result);
            }

            // 2.6 Резервирование региональной франшизы с оплатой невозвратного залога 100 000 ₽ через ЮKassa (только после регистрации и подписания оферты)
            if (req.method === 'POST' && pathname === '/api/partners/reserve') {
                const body = await readJsonBody(req);
                const user = ensureCustomerOferta(req, body);
                const reserved = store.reserveFranchiseSlot({
                    ...body,
                    ownerAccountId: user?.userId || body.ownerAccountId || '',
                    companyName: body.companyName || user?.companyName || user?.email || '',
                    inn: body.inn || user?.inn || '',
                    email: body.email || user?.email || '',
                });
                const payment = await yookassa.createPaymentForOrder(reserved.order, { originOverride: reqOrigin });
                return sendJson(res, 200, {
                    ...payment,
                    reservation: reserved.reservation,
                    order: reserved.order,
                    regionQuota: reserved.regionQuota,
                });
            }

            // 2.6.1 Добавление позиции («Купить» или «Зарезервировать») как неоплаченного заказа в Личный кабинет
            if (req.method === 'POST' && pathname === '/api/cabinet/orders/draft') {
                const body = await readJsonBody(req);
                const user = ensureCustomerOferta(req, body);
                let order;
                let reservation = null;
                if (body.kind === 'franchise_reservation' || body.regionCode) {
                    const reserved = store.reserveFranchiseSlot({
                        regionCode: body.regionCode,
                        ownerAccountId: user?.userId || '',
                        companyName: body.companyName || user?.companyName || user?.email || 'Партнёр ODANT-WORK',
                        inn: body.inn || user?.inn || '',
                        email: body.email || user?.email || '',
                    });
                    order = reserved.order;
                    reservation = reserved.reservation;
                }
                else {
                    order = store.createOrder({
                        ...body,
                        licenseId: body.licenseId || user?.licenseId || '',
                        ownerAccountId: user?.userId || '',
                        customer: {
                            name: body.customer?.name || user?.companyName || user?.email || '',
                            inn: body.customer?.inn || user?.inn || '',
                            email: body.customer?.email || user?.email || '',
                            phone: body.customer?.phone || user?.phone || '',
                        },
                    });
                }
                const updatedUser = store.findUserBySessionKey(user?.sessionKey);
                return sendJson(res, 200, {
                    ok: true,
                    order,
                    reservation,
                    user: updatedUser,
                });
            }

            // 2.6.2 Оплата существующего заказа из Личного кабинета (через ЮKassa или по счёту-договору для юрлиц)
            if (req.method === 'POST' && pathname === '/api/cabinet/orders/pay') {
                const body = await readJsonBody(req);
                const user = ensureCustomerOferta(req, body);
                const order = store.prepareOrderPayment(body.orderId, {
                    paymentMethod: body.paymentMethod || 'yookassa',
                    companyName: body.companyName || user?.companyName || '',
                    inn: body.inn || user?.inn || '',
                });
                const updatedUser = store.findUserBySessionKey(user?.sessionKey);
                if (order.paymentMethod === 'invoice') {
                    return sendJson(res, 200, {
                        ok: true,
                        orderId: order.orderId,
                        paymentMethod: 'invoice',
                        invoiceNumber: order.invoiceNumber,
                        contractNumber: order.contractNumber,
                        invoiceUrl: `${reqOrigin}${order.invoiceUrl}`,
                        confirmationUrl: `${reqOrigin}${order.invoiceUrl}`,
                        order,
                        user: updatedUser,
                    });
                }
                const payment = await yookassa.createPaymentForOrder(order, { originOverride: reqOrigin });
                return sendJson(res, 200, {
                    ok: true,
                    ...payment,
                    order,
                    user: updatedUser,
                });
            }

            // 2.6.3 Отмена (удаление) неоплаченного заказа из Личного кабинета
            if (req.method === 'POST' && pathname === '/api/cabinet/orders/cancel') {
                const body = await readJsonBody(req);
                const user = ensureCustomerOferta(req, body);
                store.cancelOrder(body.orderId);
                const updatedUser = store.findUserBySessionKey(user?.sessionKey);
                return sendJson(res, 200, {
                    ok: true,
                    orderId: body.orderId,
                    user: updatedUser,
                });
            }

            // 2.7 Собственный ИИ-агент лицензионного сервера ODANT-WORK
            if (req.method === 'POST' && pathname === '/api/agent/chat') {
                const body = await readJsonBody(req);
                const tok = extractBearerToken(req, body, url);
                const isAdmin = store.verifyAdminToken(tok);
                const user = store.findUserBySessionKey(body.sessionKey || tok);
                const reply = await agent.chat({ message: body.message || body.text || '', history: body.history || [], user, isAdmin });
                return sendJson(res, 200, reply);
            }

            // 3. Калькулятор стоимости
            if (req.method === 'POST' && pathname === '/api/quote') {
                const body = await readJsonBody(req);
                return sendJson(res, 200, calculateOrderQuote(body));
            }

            // 4. Выпуск базовой лицензии ПАК (10 вечных мест + 1 год поддержки Enterprise)
            if (req.method === 'POST' && pathname === '/api/license/issue') {
                const body = await readJsonBody(req);
                const summary = store.issueOrUpdateLicense(body);
                return sendJson(res, 200, summary);
            }

            // 5. Синхронизация лицензии с ПАК клиента (или по токену владельца)
            if (req.method === 'POST' && pathname === '/api/license/sync') {
                const body = await readJsonBody(req);
                if (body.token) {
                    const synced = store.syncByOwnerToken({
                        ...body,
                        canonicalHubUrl: body.canonicalHubUrl || reqOrigin,
                    });
                    return sendJson(res, 200, synced);
                }
                const summary = store.issueOrUpdateLicense({
                    licenseId: body.licenseId,
                    hwid: body.hwid,
                    nodeFingerprint: body.nodeFingerprint,
                    customer: body.customer,
                });
                return sendJson(res, 200, summary);
            }

            // 5.1 Синхронизация и скачивание файлов лицензий (.lic.json) по токену владельца
            if (req.method === 'POST' && pathname === '/api/license/sync-by-token') {
                const body = await readJsonBody(req);
                const tok = body.token || extractBearerToken(req, body, url);
                const result = store.syncByOwnerToken({
                    ...body,
                    token: tok,
                    canonicalHubUrl: body.canonicalHubUrl || reqOrigin,
                });
                return sendJson(res, 200, result);
            }

            // 6. Получение лицензии по ID / HWID
            if (req.method === 'GET' && pathname.startsWith('/api/license/')) {
                const id = decodeURIComponent(pathname.slice('/api/license/'.length));
                const summary = store.getLicenseSummary(id);
                if (!summary)
                    return sendJson(res, 404, { error: 'Лицензия не найдена' });
                return sendJson(res, 200, summary);
            }

            // 7. Оформление заказа: через ЮKassa ИЛИ по договору/счёту для юрлиц (только после регистрации и подписания оферты)
            if (req.method === 'POST' && pathname === '/api/orders/checkout') {
                const body = await readJsonBody(req);
                const user = ensureCustomerOferta(req, body);
                const order = store.createOrder({
                    ...body,
                    licenseId: body.licenseId || user?.licenseId || '',
                    ownerAccountId: user?.userId || body.ownerAccountId || '',
                    customer: {
                        name: body.customer?.name || user?.companyName || '',
                        inn: body.customer?.inn || user?.inn || '',
                        kpp: body.customer?.kpp || '',
                        legalAddress: body.customer?.legalAddress || '',
                        email: body.customer?.email || user?.email || '',
                        phone: body.customer?.phone || user?.phone || '',
                    },
                });
                if (order.paymentMethod === 'invoice') {
                    return sendJson(res, 200, {
                        orderId: order.orderId,
                        licenseId: order.licenseId,
                        paymentMethod: 'invoice',
                        status: order.status,
                        amountRub: order.amountRub,
                        invoiceNumber: order.invoiceNumber,
                        contractNumber: order.contractNumber,
                        invoiceUrl: `${reqOrigin}${order.invoiceUrl}`,
                        confirmationUrl: `${reqOrigin}${order.invoiceUrl}`,
                        order,
                    });
                }
                const payment = await yookassa.createPaymentForOrder(order, { originOverride: reqOrigin });
                return sendJson(res, 200, {
                    ...payment,
                    order,
                });
            }

            // 7.1 Печатная форма Счёта-договора на оплату для юридических лиц
            if (req.method === 'GET' && pathname.startsWith('/api/orders/') && pathname.endsWith('/invoice')) {
                const orderId = decodeURIComponent(pathname.slice('/api/orders/'.length, -'/invoice'.length));
                const html = store.renderOrderInvoiceHtml(orderId);
                if (!html)
                    return sendHtml(res, 404, '<h1>Счёт не найден</h1>');
                return sendHtml(res, 200, html);
            }

            // 8. Песочница оплаты ЮKassa
            if (req.method === 'GET' && pathname.startsWith('/pay/sandbox/')) {
                const orderId = decodeURIComponent(pathname.slice('/pay/sandbox/'.length));
                const order = store.getOrder(orderId);
                if (!order)
                    return sendHtml(res, 404, '<h1>Заказ не найден</h1>');
                return sendHtml(res, 200, renderSandboxPaymentPage(order));
            }

            // 9. Webhook от ЮKassa
            if (req.method === 'POST' && pathname === '/api/payments/yookassa/webhook') {
                const body = await readJsonBody(req);
                const result = await yookassa.handleWebhook(body);
                return sendJson(res, 200, result);
            }

            // 10. Webhooks ботов поддержки: MAX, Telegram, VK
            if (req.method === 'POST' && pathname === '/api/bots/max/webhook') {
                const body = await readJsonBody(req);
                const result = await bots.handleMaxWebhook(body, reqOrigin);
                return sendJson(res, 200, result);
            }
            if (req.method === 'POST' && pathname === '/api/bots/telegram/webhook') {
                const body = await readJsonBody(req);
                const result = await bots.handleTelegramWebhook(body, reqOrigin);
                return sendJson(res, 200, result);
            }
            if (req.method === 'POST' && pathname === '/api/bots/vk/webhook') {
                const body = await readJsonBody(req);
                const vkRes = await bots.handleVkWebhook(body, reqOrigin);
                if (vkRes.isVkConfirmation) {
                    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
                    res.end(vkRes.body);
                    return;
                }
                return sendJson(res, 200, vkRes.result);
            }

            // 11. Ответ инженера по тикету поддержки
            if (req.method === 'POST' && pathname.startsWith('/api/tickets/') && pathname.endsWith('/reply')) {
                const ticketId = decodeURIComponent(pathname.slice('/api/tickets/'.length, -'/reply'.length));
                const body = await readJsonBody(req);
                const ticket = store.replyToTicket(ticketId, body);
                await bots.deliverEngineerReply(ticket);
                return sendJson(res, 200, ticket);
            }

            // 12. Авторизация и защищённое API панели администратора (/admin)
            if (req.method === 'POST' && pathname === '/api/admin/login') {
                const body = await readJsonBody(req);
                try {
                    const session = store.loginAdmin(body);
                    return sendJson(res, 200, session);
                }
                catch (err) {
                    return sendJson(res, 401, { authenticated: false, error: err?.message || 'Ошибка авторизации администратора' });
                }
            }

            if (req.method === 'POST' && pathname === '/api/admin/logout') {
                const body = await readJsonBody(req);
                const tok = extractBearerToken(req, body, url);
                return sendJson(res, 200, store.logoutAdmin(tok));
            }

            if (req.method === 'GET' && pathname === '/api/admin/me') {
                const tok = extractBearerToken(req, null, url);
                if (!store.verifyAdminToken(tok))
                    return sendJson(res, 401, { authenticated: false });
                return sendJson(res, 200, { authenticated: true, login: store.adminLogin });
            }

            if (req.method === 'GET' && pathname === '/api/admin/overview') {
                const tok = extractBearerToken(req, null, url);
                if (!store.verifyAdminToken(tok))
                    return sendJson(res, 401, { error: 'Требуется авторизация администратора (/admin)' });
                return sendJson(res, 200, {
                    licenses: store.listLicenses(),
                    tickets: store.listTickets(),
                    orders: Object.values(store.state.orders),
                    partners: store.listPartners(),
                    reservations: Object.values(store.state.reservations || {}),
                    regions: store.listRegionsWithQuotas(),
                    users: store.listUsers(),
                });
            }

            if (req.method === 'POST' && pathname.startsWith('/api/admin/orders/') && pathname.endsWith('/cancel')) {
                const body = await readJsonBody(req);
                const tok = extractBearerToken(req, body, url);
                if (!store.verifyAdminToken(tok))
                    return sendJson(res, 401, { error: 'Требуется авторизация администратора' });
                const orderId = decodeURIComponent(pathname.slice('/api/admin/orders/'.length, -'/cancel'.length));
                return sendJson(res, 200, store.cancelOrder(orderId));
            }

            if (req.method === 'POST' && pathname.startsWith('/api/admin/orders/') && pathname.endsWith('/confirm-invoice')) {
                const body = await readJsonBody(req);
                const tok = extractBearerToken(req, body, url);
                if (!store.verifyAdminToken(tok))
                    return sendJson(res, 401, { error: 'Требуется авторизация администратора' });
                const orderId = decodeURIComponent(pathname.slice('/api/admin/orders/'.length, -'/confirm-invoice'.length));
                const confirmed = store.confirmInvoicePayment(orderId, body);
                if (confirmed?.license) {
                    await bots?.notifyLicenseOrderPaid(confirmed.order, confirmed.license);
                }
                return sendJson(res, 200, confirmed);
            }

            if (req.method === 'POST' && pathname.startsWith('/api/admin/tickets/') && pathname.endsWith('/close')) {
                const body = await readJsonBody(req);
                const tok = extractBearerToken(req, body, url);
                if (!store.verifyAdminToken(tok))
                    return sendJson(res, 401, { error: 'Требуется авторизация администратора' });
                const ticketId = decodeURIComponent(pathname.slice('/api/admin/tickets/'.length, -'/close'.length));
                return sendJson(res, 200, store.closeTicket(ticketId));
            }

            return sendJson(res, 404, { error: 'Not Found', path: pathname });
        }
        catch (err) {
            const status = Number(err?.statusCode) || 400;
            return sendJson(res, status, { error: err?.message || String(err), ...(err?.code ? { code: err.code } : {}) });
        }
    }

    return {
        store,
        yookassa,
        bots,
        agent,
        handler,
        listen(port = Number(process.env.PORT || 8020), host = '0.0.0.0') {
            const server = http.createServer(handler);
            return new Promise((resolve, reject) => {
                server.once('error', reject);
                server.listen(port, host, () => resolve(server));
            });
        },
    };
}
