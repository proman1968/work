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
import {
    PAK_PRODUCT,
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
} from './catalog.js';
import { LicenseStore } from './store.js';
import { YooKassaService } from './yookassa.js';
import { SupportBotsHub } from './bots.js';
import { LicenseServerAiAgent } from './agent.js';
import { renderLandingPage, renderSandboxPaymentPage } from './landing.js';

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
});
const assetCache = new Map();
let assetVersionCache = '';

/** Версия статики для сброса кэша браузера: короткий хеш стилей и скрипта витрины. */
function assetVersion() {
    if (assetVersionCache && !process.env.WORK_DEV)
        return assetVersionCache;
    const hash = crypto.createHash('sha1');
    for (const file of ['landing.css', 'landing.js'])
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
    const store = options.store || new LicenseStore({ dataDir: options.dataDir || './data' });
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

    async function handler(req, res) {
        try {
            if (req.method === 'OPTIONS') {
                res.writeHead(204, {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                });
                res.end();
                return;
            }

            const hostHeader = req.headers.host || 'work.odant.org';
            const proto = req.headers['x-forwarded-proto'] || 'http';
            const reqOrigin = `${proto}://${hostHeader}`;
            const url = new URL(req.url || '/', reqOrigin);
            const pathname = url.pathname;

            // 1. Главная страница лендинга work.odant.org и панель администратора (/admin)
            if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html' || pathname === '/admin')) {
                return sendHtml(res, 200, renderLandingPage({
                    publicKey: store.authorityKeys.publicKey,
                    regions: store.listRegionsWithQuotas(),
                    assetVersion: assetVersion(),
                    initialStage: pathname === '/admin' ? 'admin' : '',
                }));
            }

            // 1.1 Статика лендинга: логотип ODANT, стили, клиентский скрипт и контуры субъектов РФ
            if (req.method === 'GET' && STATIC_ASSETS[pathname]) {
                return sendStaticAsset(res, STATIC_ASSETS[pathname]);
            }

            // 2. Каталог ПАК, тарифов SLA и партнёрской франшизы
            if (req.method === 'GET' && pathname === '/api/catalog') {
                return sendJson(res, 200, {
                    product: PAK_PRODUCT,
                    tiers: Object.values(SLA_TIERS),
                    volumeDiscounts: SEAT_VOLUME_DISCOUNTS,
                    franchiseProgram: FRANCHISE_PROGRAM,
                    regions: store.listRegionsWithQuotas(),
                    trainingTracks: PARTNER_TRAINING_TRACKS,
                    authorityPublicKey: store.authorityKeys.publicKey,
                });
            }

            // 2.0 Вход / регистрация пользователя (для доступа к разделу докупки пользовательских лицензий)
            if (req.method === 'POST' && (pathname === '/api/auth/login' || pathname === '/api/auth/register')) {
                const body = await readJsonBody(req);
                const user = store.registerOrLoginUser(body);
                return sendJson(res, 200, user);
            }

            if (req.method === 'GET' && pathname === '/api/auth/me') {
                const authHeader = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
                const key = url.searchParams.get('sessionKey') || authHeader;
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

            // 2.6 Резервирование региональной франшизы с оплатой невозвратного залога 100 000 ₽ через ЮKassa
            if (req.method === 'POST' && pathname === '/api/partners/reserve') {
                const body = await readJsonBody(req);
                const reserved = store.reserveFranchiseSlot(body);
                const payment = await yookassa.createPaymentForOrder(reserved.order, { originOverride: reqOrigin });
                return sendJson(res, 200, {
                    ...payment,
                    reservation: reserved.reservation,
                    order: reserved.order,
                    regionQuota: reserved.regionQuota,
                });
            }

            // 2.7 Собственный ИИ-агент лицензионного сервера ODANT-WORK
            if (req.method === 'POST' && pathname === '/api/agent/chat') {
                const body = await readJsonBody(req);
                const authHeader = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
                const user = store.findUserBySessionKey(body.sessionKey || authHeader);
                const reply = await agent.chat({ message: body.message || body.text || '', history: body.history || [], user });
                return sendJson(res, 200, reply);
            }

            // 3. Калькулятор стоимости
            if (req.method === 'POST' && pathname === '/api/quote') {
                const body = await readJsonBody(req);
                return sendJson(res, 200, calculateOrderQuote(body));
            }

            // 4. Выпуск базовой лицензии ПАК (5 вечных мест + 1 год поддержки)
            if (req.method === 'POST' && pathname === '/api/license/issue') {
                const body = await readJsonBody(req);
                const summary = store.issueOrUpdateLicense(body);
                return sendJson(res, 200, summary);
            }

            // 5. Синхронизация лицензии с ПАК клиента
            if (req.method === 'POST' && pathname === '/api/license/sync') {
                const body = await readJsonBody(req);
                const summary = store.issueOrUpdateLicense({
                    licenseId: body.licenseId,
                    hwid: body.hwid,
                    nodeFingerprint: body.nodeFingerprint,
                    customer: body.customer,
                });
                return sendJson(res, 200, summary);
            }

            // 6. Получение лицензии по ID / HWID
            if (req.method === 'GET' && pathname.startsWith('/api/license/')) {
                const id = decodeURIComponent(pathname.slice('/api/license/'.length));
                const summary = store.getLicenseSummary(id);
                if (!summary)
                    return sendJson(res, 404, { error: 'Лицензия не найдена' });
                return sendJson(res, 200, summary);
            }

            // 7. Оформление заказа и создание платежа в ЮKassa
            if (req.method === 'POST' && pathname === '/api/orders/checkout') {
                const body = await readJsonBody(req);
                const order = store.createOrder(body);
                const payment = await yookassa.createPaymentForOrder(order, { originOverride: reqOrigin });
                return sendJson(res, 200, {
                    ...payment,
                    order,
                });
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

            // 12. Обзор для панели управления
            if (req.method === 'GET' && pathname === '/api/admin/overview') {
                return sendJson(res, 200, {
                    licenses: store.listLicenses(),
                    tickets: store.listTickets(),
                    orders: Object.values(store.state.orders),
                    partners: store.listPartners(),
                    reservations: Object.values(store.state.reservations || {}),
                    regions: store.listRegionsWithQuotas(),
                });
            }

            return sendJson(res, 404, { error: 'Not Found', path: pathname });
        }
        catch (err) {
            return sendJson(res, 400, { error: err?.message || String(err) });
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
