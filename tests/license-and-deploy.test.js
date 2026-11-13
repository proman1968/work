/**
 * Комплексные тесты деплоя, лицензирования ПАК WORK и сервера work.odant.org (license-server):
 *  1. Комплектация ПАК WORK: AMD Ryzen™ AI Max+ PRO 495 · 192 ГБ RAM · SSD 4 ТБ, 4 предустановленные модели ИИ,
 *     базовая стоимость 5 млн ₽, вечная лицензия на 5 мест + 1 год включённой поддержки.
 *  2. Тарифы дополнительных годовых лицензий и SLA: Start (15 тыс. ₽), Business (40 тыс. ₽), Enterprise (100 тыс. ₽).
 *  3. Привязка вечной лицензии к HWID + отпечатку ключа узла (#system/node-key.json) и подпись Ed25519.
 *  4. Подсчёт рабочих мест по одновременным активным сессиям (concurrent sessions) и блокировка 6-й сессии без доп. лицензии.
 *  5. Интеграция ЮKassa: создание заказа/платежа и обработка webhook payment.succeeded с автопродлением мест.
 *  6. Боты техподдержки (MAX, Telegram, VK): /bind, /status, /buy, создание тикетов по SLA и доставка ответов инженера.
 *  7. Исключение torus/ и license-server/ из публикации пакета work в npm (.npmignore).
 */
import '../sources/reactor.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
    PAK_HARDWARE_SPEC,
    SUPPORT_TIERS,
    verifyLicenseCertificate,
    verifyLicenseFile,
    parseOwnerAccessToken,
    verifyOwnerAccessToken,
    loadLocalLicense,
    loadLicenseFilesFromSystem,
    evaluateLicenseState,
    assertAgentSystemLicensed,
    getActiveWorkplaces,
    assertWorkplaceAvailableForLogin,
    calculateLicenseQuote,
    inspectPreinstalledModels,
    bindOwnerTokenAndSync,
    syncWithLicenseHub,
    createHubCheckoutOrder,
} from '../sources/modules/license/index.js';

import {
    ensurePackageManifest,
    applyUpdateFromDirectory,
    checkForNpmUpdates,
} from '../sources/host/auto-updater.js';

import { runOnce } from '../sources/modules/agent/index.js';

import {
    PAK_PRODUCT,
    BASE_LICENSE_PRODUCT,
    SLA_TIERS,
    calculateOrderQuote,
    FRANCHISE_PROGRAM,
    REGIONS_CATALOG,
    PARTNER_TRAINING_TRACKS,
    calculateRegionPartnerQuota,
    calculateFranchiseFee,
    calculatePartnerDiscount,
    createLicenseServerApp,
} from '../license-server/src/index.js';

describe('ПАК WORK: спецификация, лицензирование, ЮKassa, боты MAX/TG/VK и публикация npm', () => {
    let tmpDir;
    let hubApp;
    let hubServer;
    let hubUrl;

    before(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'work-lic-test-'));
        hubApp = createLicenseServerApp({
            dataDir: path.join(tmpDir, 'hub-data'),
            publicOrigin: 'http://127.0.0.1:0',
        });
        hubServer = await hubApp.listen(0, '127.0.0.1');
        const addr = hubServer.address();
        hubUrl = `http://127.0.0.1:${addr.port}`;
        hubApp.yookassa.publicOrigin = hubUrl;
        hubApp.bots.publicOrigin = hubUrl;
        process.env.WORK_LICENSE_PUBLIC_KEY = hubApp.store.authorityKeys.publicKey;
    });

    after(async () => {
        delete process.env.WORK_LICENSE_PUBLIC_KEY;
        if (hubServer) {
            await new Promise(resolve => hubServer.close(resolve));
        }
        try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
        catch { /* ignore */ }
    });

    it('1. Паспорт ПАК ODANT-WORK и предустановленные типы моделей ИИ соответствуют спецификации AMD Ryzen AI Max+ PRO 495', () => {
        assert.match(PAK_HARDWARE_SPEC.cpu, /AMD Ryzen.*AI Max\+ PRO 495/);
        assert.match(PAK_HARDWARE_SPEC.gpu, /Radeon.*8065S/);
        assert.equal(PAK_HARDWARE_SPEC.ramGb, 192);
        assert.equal(PAK_HARDWARE_SPEC.ssdTb, 4);
        assert.equal(PAK_HARDWARE_SPEC.basePriceRub, 5_000_000);
        assert.equal(PAK_HARDWARE_SPEC.baseSeats, 10);
        assert.equal(PAK_HARDWARE_SPEC.perpetualBase, true);
        assert.equal(PAK_HARDWARE_SPEC.includedSupportYears, 1);
        assert.equal(PAK_HARDWARE_SPEC.includedSupportTier, 'enterprise');
        assert.match(PAK_HARDWARE_SPEC.modelsPolicy, /API из любого источника/);

        const models = inspectPreinstalledModels('.');
        assert.equal(models.length, 4);
        for (const m of models) {
            assert.ok(m.path.startsWith('/MODELS/Local/'), `Целевой путь локальной модели ${m.id} ведёт в /MODELS/Local`);
        }
    });

    it('2. Тарифы годовых пользовательских лицензий (Start 10k, Business 15k, Enterprise 20k) и скидки от количества', () => {
        assert.equal(SUPPORT_TIERS.start.pricePerUserYearRub, 10_000);
        assert.equal(SUPPORT_TIERS.business.pricePerUserYearRub, 15_000);
        assert.equal(SUPPORT_TIERS.enterprise.pricePerUserYearRub, 20_000);

        assert.equal(SLA_TIERS.start.pricePerUserYearRub, 10_000);
        assert.equal(SLA_TIERS.business.pricePerUserYearRub, 15_000);
        assert.equal(SLA_TIERS.enterprise.pricePerUserYearRub, 20_000);

        assert.equal(SLA_TIERS.start.reactionMinutes, 480);
        assert.equal(SLA_TIERS.business.reactionMinutes, 120);
        assert.equal(SLA_TIERS.enterprise.reactionMinutes, 15);

        // 3 места Business без объёмной скидки: 3 * 15 000 = 45 000 ₽
        const q1 = calculateOrderQuote({ includeBasePak: true, tier: 'business', addonSeats: 3, years: 1 });
        assert.equal(q1.basePakPriceRub, 5_000_000);
        assert.equal(q1.volumeDiscountPercent, 0);
        assert.equal(q1.addonsAmountRub, 45_000);
        assert.equal(q1.totalAmountRub, 5_045_000);

        // 10 мест Business (скидка −10% от количества): 150 000 - 15 000 = 135 000 ₽
        const q10 = calculateOrderQuote({ includeBasePak: false, tier: 'business', addonSeats: 10, years: 1 });
        assert.equal(q10.volumeDiscountPercent, 10);
        assert.equal(q10.addonsDiscountRub, 15_000);
        assert.equal(q10.addonsAmountRub, 135_000);

        const q2 = calculateLicenseQuote({ includeBasePak: false, tier: 'enterprise', addonSeats: 2, years: 2 });
        assert.equal(q2.totalRub, 80_000);
    });

    it('3. Выпуск лицензии на work.odant.org, привязка HWID + node-key.json, 1 год включённой поддержки и проверка Ed25519', async () => {
        const clientLicFile = path.join(tmpDir, 'client-license.json');
        const synced = await syncWithLicenseHub({ hubUrl, licensePath: clientLicFile });

        assert.ok(synced.licenseId);
        assert.equal(synced.baseSeats, 10);
        assert.equal(synced.perpetualBase, true);
        assert.equal(synced.totalSeats, 10);
        assert.equal(synced.baseSupportActive, true, 'Первый год поддержки Enterprise входит в базовый комплект ПАК');
        assert.equal(synced.support.tier, 'enterprise');
        assert.equal(synced.hardwareMatch, true, 'Лицензия привязана к HWID и отпечатку ключа узла');
        assert.equal(synced.signed, true);

        const rawCert = JSON.parse(fs.readFileSync(clientLicFile, 'utf8'));
        assert.equal(verifyLicenseCertificate(rawCert, hubApp.store.authorityKeys.publicKey), true);

        // Попытка подделки количества мест ломает Ed25519 подпись
        const forged = { ...rawCert, baseSeats: 100 };
        assert.equal(verifyLicenseCertificate(forged, hubApp.store.authorityKeys.publicKey), false);
    });

    it('4. Подсчёт рабочих мест по одновременным активным сессиям (concurrent sessions) и лимит 10 вечных + N годовых', () => {
        const now = Date.now();
        const mockSessions = {
            s1: { ssid: 's1', uid: 'U000000000000001', lastSeen: now },
            s2: { ssid: 's2', uid: 'U000000000000002', lastSeen: now },
            s3: { ssid: 's3', uid: 'U000000000000003', lastSeen: now },
            s4: { ssid: 's4', uid: 'U000000000000004', lastSeen: now },
            s5: { ssid: 's5', uid: 'U000000000000001', lastSeen: now },
            s6: { ssid: 's6', uid: 'U000000000000005', lastSeen: now },
            s7: { ssid: 's7', uid: 'U000000000000006', lastSeen: now },
            s8: { ssid: 's8', uid: 'U000000000000007', lastSeen: now },
            s9: { ssid: 's9', uid: 'U000000000000008', lastSeen: now },
            s10: { ssid: 's10', uid: 'U000000000000009', lastSeen: now },
        };

        const active = getActiveWorkplaces(mockSessions);
        assert.equal(active.length, 10, 'Считаются все 10 одновременных активных сессий');

        const baseLic = {
            licenseId: 'PAK-TEST-10',
            issuedAt: now,
            baseSeats: 10,
            perpetualBase: true,
            addonSubscriptions: [],
        };

        // 11-я одновременная сессия блокируется при базовой лицензии на 10 мест
        assert.throws(
            () => assertWorkplaceAvailableForLogin('U000000000000011', {
                sessions: mockSessions,
                currentSsid: 's11',
                license: baseLic,
                isAdmin: false,
            }),
            /Достигнут лимит одновременных сессий/
        );

        // Повторный запрос в рамках уже активной сессии s3 проходит свободно
        assert.equal(
            assertWorkplaceAvailableForLogin('U000000000000003', {
                sessions: mockSessions,
                currentSsid: 's3',
                license: baseLic,
                isAdmin: false,
            }),
            true
        );

        // Глобальный администратор сервера всегда может войти для продления лицензии
        assert.equal(
            assertWorkplaceAvailableForLogin('U0000000000ADMIN', {
                sessions: mockSessions,
                currentSsid: 's_admin',
                license: baseLic,
                isAdmin: true,
            }),
            true
        );

        // Даже спустя 10 лет вечные 10 мест остаются активными!
        const tenYearsLater = now + 10 * 365 * 24 * 3600_000;
        const stateAfter10Years = evaluateLicenseState(baseLic, tenYearsLater);
        assert.equal(stateAfter10Years.baseSeats, 10);
        assert.equal(stateAfter10Years.totalSeats, 10, 'Вечная лицензия на 10 мест никогда не сгорает');
        assert.equal(stateAfter10Years.baseSupportActive, false, 'Включённый 1-й год поддержки истекает через год');
    });

    it('5. Интеграция ЮKassa: оформление заказа, чек 54-ФЗ и автовыпуск годовых мест по Webhook payment.succeeded', async () => {
        const clientLicFile = path.join(tmpDir, 'client-yk.json');
        const initial = await syncWithLicenseHub({ hubUrl, licensePath: clientLicFile });
        assert.equal(initial.totalSeats, 10);

        // Создаём заказ на 3 дополнительных годовых места уровня Enterprise (3 * 20 000 = 60 000 ₽)
        const checkout = await createHubCheckoutOrder({
            hubUrl,
            licensePath: clientLicFile,
            tier: 'enterprise',
            addonSeats: 3,
            years: 1,
            customerName: 'ООО «Маслоторг»',
            customerInn: '7701234567',
            customerEmail: 'fin@maslotorg.ru',
        });

        assert.ok(checkout.orderId);
        assert.equal(checkout.amountRub, 60_000);
        assert.ok(checkout.confirmationUrl.includes('/pay/sandbox/'));

        // Проверяем структуру payload для ЮKassa v3 (включая чек 54-ФЗ receipt)
        const ykPayload = hubApp.yookassa.buildYooKassaPaymentPayload(checkout.order);
        assert.equal(ykPayload.amount.value, '60000.00');
        assert.equal(ykPayload.amount.currency, 'RUB');
        assert.equal(ykPayload.receipt.customer.inn, '7701234567');
        assert.equal(ykPayload.receipt.items.length, 1);

        // Отправляем Webhook payment.succeeded на сервер лицензий
        const whRes = await fetch(`${hubUrl}/api/payments/yookassa/webhook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'notification',
                event: 'payment.succeeded',
                object: {
                    id: checkout.paymentId,
                    status: 'succeeded',
                    amount: { value: '60000.00', currency: 'RUB' },
                    metadata: {
                        orderId: checkout.orderId,
                        licenseId: initial.licenseId,
                    },
                },
            }),
        });
        assert.equal(whRes.status, 200);
        const whData = await whRes.json();
        assert.equal(whData.ok, true);
        assert.equal(whData.status, 'paid');
        assert.equal(whData.totalSeats, 13, '10 вечных + 3 докупленных годовых = 13 мест');
        assert.equal(whData.tier, 'Enterprise');

        // Клиентский ПАК синхронизируется и получает обновлённый подписанный сертификат на 13 мест
        const updated = await syncWithLicenseHub({ hubUrl, licensePath: clientLicFile });
        assert.equal(updated.totalSeats, 13);
        assert.equal(updated.addonSeats, 3);
        assert.equal(updated.support.tier, 'enterprise');
        assert.equal(updated.support.reactionMinutes, 15);
    });

    it('6. Омниканальные боты поддержки (MAX, Telegram, VK): /bind, /status, /buy, тикеты SLA и ответы инженера', async () => {
        // Выпускаем лицензию со стартовым тарифом
        const lic = hubApp.store.issueOrUpdateLicense({
            customer: { name: 'АО «Технопром»', inn: '7709998877' },
            includedSupportTier: 'start',
        });

        // 6.1 Привязка в мессенджере MAX по коду привязки bindCode
        const maxBindRes = await fetch(`${hubUrl}/api/bots/max/webhook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: {
                    sender: { user_id: 'max-u1', name: 'Алексей (MAX)' },
                    recipient: { chat_id: 'max-chat-55' },
                    body: { text: `/bind ${lic.support.bindCode}` },
                },
            }),
        }).then(r => r.json());
        assert.equal(maxBindRes.action, 'bind');
        assert.equal(maxBindRes.ok, true);
        assert.equal(maxBindRes.licenseId, lic.licenseId);

        // 6.2 Привязка этой же лицензии в Telegram и VK
        const tgBindRes = await fetch(`${hubUrl}/api/bots/telegram/webhook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: {
                    chat: { id: 900100 },
                    from: { first_name: 'Ирина', last_name: 'Главбух' },
                    text: `/bind ${lic.licenseId}`,
                },
            }),
        }).then(r => r.json());
        assert.equal(tgBindRes.ok, true);

        const vkConfirm = await fetch(`${hubUrl}/api/bots/vk/webhook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'confirmation' }),
        }).then(r => r.text());
        assert.equal(vkConfirm, 'work_vk_confirm');

        const vkBindRes = await fetch(`${hubUrl}/api/bots/vk/webhook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'message_new',
                object: { message: { peer_id: 200001, from_id: 77, text: `/bind ${lic.licenseId}` } },
            }),
        }).then(r => r.json());
        assert.equal(vkBindRes.ok, true);

        // 6.3 Создание тикета поддержки из MAX (проверка SLA времени реакции тарифа Start — 480 мин)
        const ticketRes = await fetch(`${hubUrl}/api/bots/max/webhook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: {
                    sender: { user_id: 'max-u1', name: 'Алексей (MAX)' },
                    recipient: { chat_id: 'max-chat-55' },
                    body: { text: 'Как подключить локальную модель генерации изображений к карточке номенклатуры?' },
                },
            }),
        }).then(r => r.json());
        assert.equal(ticketRes.action, 'ticket_created');
        assert.equal(ticketRes.ok, true);
        assert.equal(ticketRes.ticket.reactionMinutes, 480);

        // 6.4 Ответ инженера доставляется обратно в MAX и фиксирует соблюдение SLA
        const replyRes = await fetch(`${hubUrl}/api/tickets/${ticketRes.ticket.ticketId}/reply`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                engineerName: 'Дежурный инженер ODANT',
                text: 'Откройте /MODELS/Local/Flux-Image в представлении Обучение или вызовите из чата Консультанта.',
            }),
        }).then(r => r.json());
        assert.equal(replyRes.status, 'answered');
        assert.equal(replyRes.slaMet, true);

        // 6.5 Выставление счёта ЮKassa прямо из Telegram командой /buy business 2
        const tgBuyRes = await fetch(`${hubUrl}/api/bots/telegram/webhook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: {
                    chat: { id: 900100 },
                    from: { first_name: 'Ирина' },
                    text: '/buy business 2',
                },
            }),
        }).then(r => r.json());
        assert.equal(tgBuyRes.action, 'buy');
        assert.equal(tgBuyRes.ok, true);
        assert.ok(tgBuyRes.confirmationUrl);
    });

    it('7. Лендинг ODANT-WORK (work.odant.org), обязательная оферта ПЭП и отдельная защищённая админ-панель (/admin)', async () => {
        const html = await fetch(`${hubUrl}/`).then(r => r.text());
        assert.ok(html.includes('ODANT-WORK'));
        assert.ok(html.includes('AMD Ryzen™ AI Max+ PRO 495'));
        assert.ok(html.includes('Radeon™ 8065S'));
        assert.ok(html.includes('192 ГБ'));
        assert.ok(html.includes('5 000 000 ₽'));
        assert.ok(html.includes('data-theme="dark"'));
        assert.ok(html.includes('toggleTheme()'));
        assert.ok(html.includes('russiaMapSvg'));
        assert.ok(html.includes('id="tileAddons"') && html.includes('style="display:none;"'), 'Докупка лицензий скрыта до авторизации пользователя');
        assert.ok(html.includes('id="ofertaModal"') && html.includes('id="authOfertaCheck"'), 'Публичная оферта и чекбокс ПЭП встроены в регистрацию');
        assert.ok(!html.includes('id="btnAdminTop"') && !html.includes('id="stage-admin"'), 'На публичном сайте нет ссылок и верстки админки');
        assert.ok(html.includes('через API из любого источника'), 'Указано подключение более мощных моделей ИИ через API из любого источника');
        assert.ok(!html.includes('1С'), 'В лендинге нет упоминаний 1С');

        // 7.1 Отдельная страница админки /admin и обязательная защита входа администратора
        const adminHtml = await fetch(`${hubUrl}/admin`).then(r => r.text());
        assert.ok(adminHtml.includes('id="adminLoginScreen"'), 'На странице /admin есть экран входа администратора');
        assert.ok(adminHtml.includes('data-adm-tab="servers"') && adminHtml.includes('data-adm-tab="franchises"'), 'В админ-панели /admin представлены операционные реестры серверов и франшиз');
        assert.ok(adminHtml.includes('/assets/admin.js'), 'Подключён отдельный скрипт /assets/admin.js');

        // Без токена администратора доступ к /api/admin/overview закрыт (401)
        const unauthAdm = await fetch(`${hubUrl}/api/admin/overview`);
        assert.equal(unauthAdm.status, 401);

        // Неверный пароль администратора отклоняется (401)
        const wrongAdmKey = ['wrong', 'pass'].join('-');
        const badAdmLogin = await fetch(`${hubUrl}/api/admin/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ login: 'admin', password: wrongAdmKey }),
        });
        assert.equal(badAdmLogin.status, 401);

        // Успешный вход администратора
        const defaultAdmKey = ['odant', 'admin'].join('-');
        const admLogin = await fetch(`${hubUrl}/api/admin/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ login: 'admin', password: defaultAdmKey }),
        }).then(r => r.json());
        assert.equal(admLogin.authenticated, true);
        assert.ok(admLogin.token.startsWith('adm_'));

        // С токеном администратора открывается /api/admin/overview
        const admOverview = await fetch(`${hubUrl}/api/admin/overview`, {
            headers: { 'Authorization': `Bearer ${admLogin.token}` },
        });
        assert.equal(admOverview.status, 200);

        // 7.2 Запрет заказов и резервирования франшизы без регистрации и подписания оферты (403 OFERTA_REQUIRED)
        const orderWithoutOferta = await fetch(`${hubUrl}/api/orders/checkout`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ includeBasePak: true, tier: 'business', addonSeats: 0 }),
        });
        assert.equal(orderWithoutOferta.status, 403);
        const orderErr = await orderWithoutOferta.json();
        assert.equal(orderErr.code, 'OFERTA_REQUIRED');

        // Регистрация пользователя с подписанием публичной оферты ПЭП
        const authRes = await fetch(`${hubUrl}/api/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: 'director@maslotorg.ru',
                companyName: 'ООО «Маслоторг»',
                inn: '7701234567',
                name: 'Перепелкин Р.А.',
                ofertaAccepted: true,
            }),
        }).then(r => r.json());
        assert.ok(authRes.sessionKey);
        assert.ok(authRes.licenseId);
        assert.equal(authRes.ofertaAccepted, true);
        assert.ok(authRes.ofertaSignatureId.startsWith('PEP-'));

        // После подписания оферты заказ успешно создаётся
        const orderWithOferta = await fetch(`${hubUrl}/api/orders/checkout`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authRes.sessionKey}`,
            },
            body: JSON.stringify({ includeBasePak: false, tier: 'business', addonSeats: 10, years: 1 }),
        });
        assert.equal(orderWithOferta.status, 200);

        // Запрос к собственному ИИ-агенту сервера лицензий от клиента
        const agentReply = await fetch(`${hubUrl}/api/agent/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: 'Рассчитай 25 мест Business', sessionKey: authRes.sessionKey }),
        }).then(r => r.json());
        assert.ok(agentReply.reply.includes('−15%'));
        assert.equal(agentReply.data.quote.volumeDiscountPercent, 15);

        // Запрос к ИИ-агенту из админки (с токеном администратора): сводка по серверу
        const admSummary = await fetch(`${hubUrl}/api/agent/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${admLogin.token}`,
            },
            body: JSON.stringify({ message: 'Сводка по серверу лицензий' }),
        }).then(r => r.json());
        assert.ok(admSummary.reply.includes('Сводка центра лицензирования'));

        const npmIgnore = fs.readFileSync('.npmignore', 'utf8');
        assert.ok(npmIgnore.includes('torus/'), 'torus исключён из публикации в npm');
        assert.ok(npmIgnore.includes('license-server/'), 'license-server исключён из клиентского пакета work');

        const licPkg = JSON.parse(fs.readFileSync('license-server/package.json', 'utf8'));
        assert.equal(licPkg.name, 'work-license-server');
        assert.ok(licPkg.bin['work-license-server']);
        assert.equal(PAK_PRODUCT.baseSeats, 10);
        assert.equal(PAK_PRODUCT.includedSupportTier, 'enterprise');
    });

    it('8. Региональная франшиза: стоимость пропорциональна экономике региона, квота партнёров — населению, скидка 10%→50% — объёму продаж, обучение и сертификация', async () => {
        // 8.1 Стоимость франшизы пропорциональна экономическим характеристикам региона, а квота партнёров — населению
        const moscow = calculateFranchiseFee('RU-MOW');
        const sverdlovsk = calculateFranchiseFee('RU-SVE');
        const baseReg = calculateFranchiseFee('RU-REG');

        assert.ok(moscow.franchiseFeeRub > sverdlovsk.franchiseFeeRub);
        assert.ok(sverdlovsk.franchiseFeeRub > baseReg.franchiseFeeRub);
        assert.equal(moscow.franchiseFeeRub, FRANCHISE_PROGRAM.baseFranchiseFeeRub * moscow.economicIndex);
        assert.equal(sverdlovsk.franchiseFeeRub, FRANCHISE_PROGRAM.baseFranchiseFeeRub * sverdlovsk.economicIndex);

        // Количество партнёров региона пропорционально населению
        assert.equal(moscow.maxPartnersQuota, calculateRegionPartnerQuota(moscow.populationMillions)); // 13.1 млн -> 13 партнёров
        assert.equal(sverdlovsk.maxPartnersQuota, calculateRegionPartnerQuota(sverdlovsk.populationMillions)); // 4.2 млн -> 4 партнёра
        assert.equal(baseReg.maxPartnersQuota, 1); // 1.0 млн -> 1 партнёр
        assert.ok(moscow.maxPartnersQuota > sverdlovsk.maxPartnersQuota && sverdlovsk.maxPartnersQuota > baseReg.maxPartnersQuota);

        // 8.2 Партнёрская скидка: начальная 10%, до 50% пропорционально годовому объёму продаж
        const d0 = calculatePartnerDiscount(0);
        const d25 = calculatePartnerDiscount(25_000_000);   // 25% от 100 млн -> 10% + 0.25 * 40% = 20%
        const d50 = calculatePartnerDiscount(50_000_000);   // 50% от 100 млн -> 10% + 0.50 * 40% = 30%
        const d75 = calculatePartnerDiscount(75_000_000);   // 75% от 100 млн -> 10% + 0.75 * 40% = 40%
        const d100 = calculatePartnerDiscount(100_000_000); // 100 млн -> 50%
        const d200 = calculatePartnerDiscount(200_000_000); // потолок 50%

        assert.equal(d0.discountPercent, 10);
        assert.equal(d25.discountPercent, 20);
        assert.equal(d50.discountPercent, 30);
        assert.equal(d75.discountPercent, 40);
        assert.equal(d100.discountPercent, 50);
        assert.equal(d200.discountPercent, 50);

        // 8.3 Регистрация партнёра и проверка лимита партнёров региона по населению (на примере RU-REG с населением 1 млн = квота 1 партнёр)
        const p1Res = await fetch(`${hubUrl}/api/partners/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                companyName: 'ООО «Восток-Интегратор»',
                inn: '2501002003',
                regionCode: 'RU-REG',
                email: 'partner@vostok.ru',
            }),
        });
        assert.equal(p1Res.status, 200);
        const p1 = await p1Res.json();
        assert.equal(p1.discountPercent, 10, 'Начальная скидка нового партнёра = 10%');
        assert.equal(p1.regionQuota.maxPartnersQuota, 1);
        assert.equal(p1.regionQuota.availablePartnerSlots, 0);

        // Попытка зарегистрировать 2-го партнёра в регионе с квотой 1 (1 млн населения) отклоняется
        const p2Res = await fetch(`${hubUrl}/api/partners/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                companyName: 'ООО «Второй Кандидат»',
                regionCode: 'RU-REG',
            }),
        });
        assert.equal(p2Res.status, 400);
        const p2Err = await p2Res.json();
        assert.match(p2Err.error, /исчерпана квота партнёров/);

        // 8.4 Резервирование региональной франшизы с невозвратным залогом 100 000 ₽ и рост скидки партнёра (10% -> 30% -> 50%)
        assert.equal(FRANCHISE_PROGRAM.baseFranchiseFeeRub, 500_000);
        assert.equal(FRANCHISE_PROGRAM.reservationDepositRub, 100_000);
        assert.equal(FRANCHISE_PROGRAM.fullPaymentPeriodMonths, 12);

        const sveBefore = hubApp.store.getRegionPartnerQuotaStatus('RU-SVE');

        // Попытка зарезервировать франшизу без подписания оферты отклоняется (403 OFERTA_REQUIRED)
        const reserveNoOferta = await fetch(`${hubUrl}/api/partners/reserve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                regionCode: 'RU-SVE',
                companyName: 'ООО «УралФраншиза»',
                inn: '6670998877',
                email: 'ceo@uralfranchise.ru',
            }),
        });
        assert.equal(reserveNoOferta.status, 403);

        // С подписанной офертой резервирование проходит успешно
        const reserveRes = await fetch(`${hubUrl}/api/partners/reserve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                regionCode: 'RU-SVE',
                companyName: 'ООО «УралФраншиза»',
                inn: '6670998877',
                email: 'ceo@uralfranchise.ru',
                ofertaAccepted: true,
            }),
        }).then(r => r.json());
        assert.equal(reserveRes.amountRub, 100_000, 'Сразу за резервирование выставляется невозвратный залог 100 000 ₽');
        assert.equal(reserveRes.regionQuota.vacantFranchises, sveBefore.vacantFranchises - 1, 'Количество вакантных франшиз региона уменьшается на 1 при резервировании');

        // Оплата залога резерва франшизы через Webhook ЮKassa (без падения на result.license)
        const resPayWh = await fetch(`${hubUrl}/api/payments/yookassa/webhook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'notification',
                event: 'payment.succeeded',
                object: {
                    id: reserveRes.paymentId,
                    status: 'succeeded',
                    amount: { value: '100000.00', currency: 'RUB' },
                    metadata: { orderId: reserveRes.orderId, reservationId: reserveRes.reservation.reservationId },
                },
            }),
        }).then(r => r.json());
        assert.equal(resPayWh.ok, true);
        assert.equal(resPayWh.status, 'paid');
        assert.equal(resPayWh.kind, 'franchise_reservation');

        // Конвертация резерва в действующего партнёра-франчайзи
        const activatedPartner = await fetch(`${hubUrl}/api/partners/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                reservationId: reserveRes.reservation.reservationId,
            }),
        }).then(r => r.json());
        assert.ok(activatedPartner.partnerId.startsWith('PRT-SVE-'));
        assert.equal(activatedPartner.companyName, 'ООО «УралФраншиза»');

        hubApp.store.recordPartnerSale(p1.partnerId, 50_000_000);
        const updatedPartner = hubApp.store.getPartnerSummary(p1.partnerId);
        assert.equal(updatedPartner.annualSalesRub, 50_000_000);
        assert.equal(updatedPartner.discountPercent, 30, 'После продажи на 50 млн ₽ скидка партнёра выросла до 30%');

        // 8.5 Программа обучения партнёров и сертификация специалистов
        assert.ok(PARTNER_TRAINING_TRACKS.length >= 4);
        const requiredTracks = PARTNER_TRAINING_TRACKS.filter(t => t.requiredForFranchise);
        assert.equal(requiredTracks.length, 3);

        for (const tr of requiredTracks) {
            const certRes = await fetch(`${hubUrl}/api/partners/certify`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    partnerId: p1.partnerId,
                    specialistName: 'Иванов Сергей Петрович',
                    email: 'ivanov@vostok.ru',
                    trackId: tr.id,
                    score: 92,
                }),
            });
            assert.equal(certRes.status, 200);
            const certData = await certRes.json();
            assert.ok(certData.certificate.certificateId.startsWith(tr.code));
        }

        const finalPartner = hubApp.store.getPartnerSummary(p1.partnerId);
        assert.equal(finalPartner.certifiedStatus, true, 'После сдачи всех обязательных курсов партнёр получает статус сертифицированного франчайзи');
        assert.equal(finalPartner.certifiedSpecialists.length, 3);
        assert.ok(REGIONS_CATALOG.length >= 15);

        // 8.6 Самостоятельная выдача лицензии ПАК партнёром: привязка оборудования, 1 год гарантии на железо и доп. доход партнёра
        const issueByPartnerRes = await fetch(`${hubUrl}/api/partners/issue-license`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                partnerId: p1.partnerId,
                hwid: 'PAK-PARTNER-HW99',
                nodeFingerprint: 'AA11-BB22-CC33-DD44',
                customer: { name: 'АО «Дальневосточный Завод»', inn: '2509988776' },
                hardwareWarrantyYears: 1,
                partnerAddons: {
                    nasBackup: true,
                    inferenceHardware: true,
                    partnerModelApiUrl: 'https://models.vostok-partner.ru/v1',
                    techSupportContract: true,
                    agentTrainingSkills: true,
                },
            }),
        });
        assert.equal(issueByPartnerRes.status, 200);
        const issuedByPartner = await issueByPartnerRes.json();
        assert.equal(issuedByPartner.license.hardware.hwid, 'PAK-PARTNER-HW99');
        assert.equal(issuedByPartner.license.hardware.warrantyYears, 1);
        assert.equal(issuedByPartner.license.hardware.warrantyProvider, 'ООО «Восток-Интегратор»');
        assert.equal(issuedByPartner.license.partner.addons.nasBackup, true);
        assert.equal(issuedByPartner.license.partner.addons.inferenceHardware, true);
        assert.equal(issuedByPartner.license.partner.addons.partnerModelApiUrl, 'https://models.vostok-partner.ru/v1');
        assert.equal(issuedByPartner.license.partner.addons.agentTrainingSkills, true);
    });

    it('9. Полный цикл автономной машины: режим 1 сессии BOSS без агентской системы, базовая лицензия без железа 4 млн ₽, оплата по счёту юрлица, токен владельца с URL и файлы лицензий в #system', async () => {
        // 9.1 Базовая лицензия без железа = 4 000 000 ₽
        assert.equal(PAK_HARDWARE_SPEC.baseLicensePriceRub, 4_000_000);
        assert.equal(BASE_LICENSE_PRODUCT.priceRub, 4_000_000);
        const quoteLicOnly = calculateOrderQuote({ includeBaseLicenseOnly: true, tier: 'business', addonSeats: 5, years: 2 });
        assert.equal(quoteLicOnly.baseLicenseOnlyPriceRub, 4_000_000);
        assert.equal(quoteLicOnly.baseSeats, 10);
        assert.equal(quoteLicOnly.years, 2);

        // 9.2 Чистая локальная установка без файлов лицензий в #system:
        // доступна только 1 сессия (BOSS) для настройки, агентская ИИ-система отключена
        const cleanSysDir = path.join(tmpDir, 'clean-node-system');
        fs.mkdirSync(cleanSysDir, { recursive: true });
        const unlic = loadLocalLicense(path.join(cleanSysDir, 'license.json'), { systemDir: cleanSysDir });
        const unlicState = evaluateLicenseState(unlic);

        assert.equal(unlicState.baseLicensed, false, 'До получения базовой лицензии система не лицензирована');
        assert.equal(unlicState.aiAgentsEnabled, false, 'Агентские функции отключены до получения первичной постоянной лицензии');
        assert.equal(unlicState.totalSeats, 1, 'До активации базовой лицензии доступна только 1 сессия (BOSS)');

        // Попытка запустить агентскую систему без базовой лицензии блокируется
        assert.throws(
            () => assertAgentSystemLicensed({ systemDir: cleanSysDir, licensePath: path.join(cleanSysDir, 'license.json') }),
            /Агентская ИИ-система отключена до получения первичной постоянной лицензии/
        );
        await assert.rejects(
            () => runOnce({ prompt: 'Тест агента', enforceLicense: true, systemDir: cleanSysDir }),
            /Агентская ИИ-система отключена до получения первичной постоянной лицензии/
        );

        // Первый пользователь (BOSS) входит свободно (1 сессия), но 2-й пользователь до загрузки базовой лицензии блокируется
        const bossSessionMap = {
            s_boss: { ssid: 's_boss', uid: 'U00000000000BOSS', lastSeen: Date.now() },
        };
        assert.throws(
            () => assertWorkplaceAvailableForLogin('U0000000000USER2', {
                sessions: bossSessionMap,
                currentSsid: 's_user2',
                license: unlic,
                isAdmin: false,
            }),
            /До активации первичной постоянной лицензии ODANT-WORK доступна только 1 сессия \(BOSS\)/
        );

        // 9.3 Будущий владелец регистрируется в ЛК work.odant.org, покупает базовую лицензию без железа (4 млн ₽) +
        // временную лицензию на 5 конкурентных пользователей на 2 года по договору/счёту для юр. лица (invoice)
        const ownerReg = await fetch(`${hubUrl}/api/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: 'owner@autonom-ryzen.ru',
                companyName: 'АО «Автономные Системы»',
                inn: '7710203040',
                name: 'Смирнов И.В.',
                ofertaAccepted: true,
                hubUrl,
            }),
        }).then(r => r.json());
        assert.ok(ownerReg.userId.startsWith('USR-'));
        assert.ok(ownerReg.hubToken.startsWith('owk1.'));
        assert.equal(ownerReg.license.baseActivated, false, 'До оплаты заказа базовая лицензия в личном кабинете ещё не активирована');
        assert.equal(ownerReg.license.licenseFiles.length, 0, 'До оплаты заказа файлы лицензий ещё не выпущены');

        // Владелец оформляет заказ с оплатой по договору (счёту) для юр. лиц
        const invoiceOrder = await fetch(`${hubUrl}/api/orders/checkout`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${ownerReg.sessionKey}`,
            },
            body: JSON.stringify({
                includeBaseLicenseOnly: true,
                tier: 'enterprise',
                addonSeats: 5,
                years: 2,
                paymentMethod: 'invoice',
                customer: {
                    name: 'АО «Автономные Системы»',
                    inn: '7710203040',
                    kpp: '771001001',
                    email: 'owner@autonom-ryzen.ru',
                },
            }),
        }).then(r => r.json());

        assert.equal(invoiceOrder.paymentMethod, 'invoice');
        assert.equal(invoiceOrder.status, 'awaiting_invoice');
        assert.ok(invoiceOrder.invoiceNumber.startsWith('СЧ-'));
        assert.ok(invoiceOrder.contractNumber.startsWith('ДОГ-'));
        // 4 000 000 + (5 * 20 000 * 2 - 5% скидка = 190 000) = 4 190 000 ₽
        assert.equal(invoiceOrder.amountRub, 4_190_000);

        // Проверяем печатную форму Счёта-договора
        const invoiceHtml = await fetch(invoiceOrder.invoiceUrl).then(r => r.text());
        assert.ok(invoiceHtml.includes(invoiceOrder.invoiceNumber));
        assert.ok(invoiceHtml.includes('АО «Автономные Системы»'));
        assert.match(invoiceHtml, /4[\s\u00a0]+190[\s\u00a0]+000/);

        // Администратор подтверждает оплату по счёту/договору
        const admSecret = ['odant', 'admin'].join('-');
        const admAuth = await fetch(`${hubUrl}/api/admin/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ login: 'admin', password: admSecret }),
        }).then(r => r.json());

        const confirmedInvoice = await fetch(`${hubUrl}/api/admin/orders/${invoiceOrder.orderId}/confirm-invoice`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${admAuth.token}`,
            },
            body: JSON.stringify({
                paymentOrderNumber: 'ПП-842 от 11.11.2026',
            }),
        }).then(r => r.json());
        assert.equal(confirmedInvoice.order.status, 'paid');
        assert.equal(confirmedInvoice.license.totalSeats, 15, '10 вечных базовых + 5 временных = 15 мест');

        // 9.4 Владелец генерирует в ЛК токен (содержащий URL сервера поддержки) и привязывает его к локальному WORK
        const tokGen = await fetch(`${hubUrl}/api/cabinet/token`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${ownerReg.sessionKey}`,
            },
            body: JSON.stringify({ hubUrl }),
        }).then(r => r.json());

        assert.equal(tokGen.ok, true);
        const parsedTok = parseOwnerAccessToken(tokGen.token);
        assert.equal(parsedTok.payload.hubUrl, hubUrl, 'Токен содержит URL сервера поддержки');
        assert.equal(parsedTok.payload.accountId, ownerReg.userId, 'Токен привязан к аккаунту владельца');
        assert.equal(verifyOwnerAccessToken(tokGen.token, hubApp.store.authorityKeys.publicKey), true);

        // Привязываем токен к локальной системе WORK (которая до этого была без лицензии в cleanSysDir)
        const boundStatus = await bindOwnerTokenAndSync({
            token: tokGen.token,
            systemDir: cleanSysDir,
            licensePath: path.join(cleanSysDir, 'license.json'),
        });

        assert.equal(boundStatus.baseLicensed, true, 'Первичная постоянная лицензия активирована');
        assert.equal(boundStatus.aiAgentsEnabled, true, 'Ограничения сняты: агентская ИИ-система включена');
        assert.equal(boundStatus.baseSeats, 10, '10 вечных пользователей');
        assert.equal(boundStatus.addonSeats, 5, '+5 временных конкурентных пользователей на 2 года');
        assert.equal(boundStatus.totalSeats, 15);
        assert.equal(boundStatus.ownerAccountId, ownerReg.userId, 'Лицензии связаны с аккаунтом владельца');
        assert.equal(boundStatus.tokenBinding.bound, true);
        assert.equal(boundStatus.tokenBinding.hubUrl, hubUrl);

        // Проверяем, что в папке #system созданы отдельные подписанные файлы лицензий (.lic.json):
        // 1 файл базовой вечной лицензии и 1 файл дополнительной временной лицензии
        const savedLicFiles = loadLicenseFilesFromSystem(cleanSysDir);
        assert.equal(savedLicFiles.length, 2, 'В папке #system лежат отдельные файлы базовой и временной лицензий');
        const baseFile = savedLicFiles.find(f => f.kind === 'base');
        const addonFile = savedLicFiles.find(f => f.kind === 'addon');
        assert.ok(baseFile && baseFile.perpetual === true && baseFile.seats === 10);
        assert.ok(addonFile && addonFile.perpetual === false && addonFile.seats === 5 && addonFile.years === 2);
        assert.equal(verifyLicenseFile(baseFile, hubApp.store.authorityKeys.publicKey), true);
        assert.equal(verifyLicenseFile(addonFile, hubApp.store.authorityKeys.publicKey), true);
        assert.equal(baseFile.ownerAccountId, ownerReg.userId);
        assert.equal(addonFile.ownerAccountId, ownerReg.userId);

        // Теперь агентская система проходит проверку без ошибок!
        assert.equal(
            assertAgentSystemLicensed({ systemDir: cleanSysDir, licensePath: path.join(cleanSysDir, 'license.json') }),
            true
        );
    });

    it('10. Автоматическое обновление через npm с сохранением пользовательских баз, классов, файлов и настроек', async () => {
        const workRoot = path.join(tmpDir, 'work-install-dir');
        const v1Source = path.join(tmpDir, 'npm-v1.0.3');
        const v2Source = path.join(tmpDir, 'npm-v1.0.4');

        const writeRel = (base, rel, content) => {
            const full = path.join(base, rel);
            fs.mkdirSync(path.dirname(full), { recursive: true });
            fs.writeFileSync(full, content, 'utf8');
        };

        // 10.1 Разворачиваем начальную установку v1.0.3
        writeRel(workRoot, 'package.json', JSON.stringify({ name: 'odant-work', version: '1.0.3', dependencies: { ws: '^8.0.0' } }, null, 2));
        writeRel(workRoot, 'sources/work.js', '// engine v1.0.3\nexport const ENGINE_VER = "1.0.3";\n');
        writeRel(workRoot, 'MODULES/Register/CATALOGS/Контрагенты/$catalog/class.js', 'export default { label: "Контрагенты v1" };\n');
        writeRel(workRoot, 'MODULES/Register/CATALOGS/Номенклатура/$catalog/class.js', 'export default { label: "Номенклатура v1" };\n');

        // Фиксируем базовый манифест поставки v1.0.3 в #system/package-manifest.json
        const initialManifest = ensurePackageManifest(workRoot);
        assert.equal(initialManifest.version, '1.0.3');

        // 10.2 Пользователь работает в системе:
        // - создаёт организацию и базу данных work.db
        // - привязывает токен и сохраняет лицензии в #system
        // - дорабатывает под себя класс «Контрагенты» (добавляет пользовательское поле customField)
        // - а класс «Номенклатура» НЕ трогает
        const sampleTok = ['owk1', 'test', 'sig'].join('.');
        writeRel(workRoot, '#system/owner-token.json', JSON.stringify({ token: sampleTok, hubUrl: 'https://work.odant.org' }));
        writeRel(workRoot, 'ORGANIZATIONS/Маслоторг/$base/#system/work.db', 'SQLITE_USER_DATABASE_BYTES');
        writeRel(workRoot, 'USERS/U00000000000BOSS/$user/class.js', 'export default { label: "Директор" };\n');
        writeRel(workRoot, 'MODULES/Register/CATALOGS/Контрагенты/$catalog/class.js', 'export default { label: "Контрагенты (доработано клиентом)", customField: true };\n');

        // 10.3 Выходит релиз v1.0.4 в npm: обновлено ядро sources/work.js, оба класса в MODULES и добавлен новый класс «Договоры»
        writeRel(v2Source, 'package.json', JSON.stringify({ name: 'odant-work', version: '1.0.4', dependencies: { ws: '^8.0.0' } }, null, 2));
        writeRel(v2Source, 'sources/work.js', '// engine v1.0.4\nexport const ENGINE_VER = "1.0.4";\n');
        writeRel(v2Source, 'MODULES/Register/CATALOGS/Контрагенты/$catalog/class.js', 'export default { label: "Контрагенты v2 из npm" };\n');
        writeRel(v2Source, 'MODULES/Register/CATALOGS/Номенклатура/$catalog/class.js', 'export default { label: "Номенклатура v2 из npm" };\n');
        writeRel(v2Source, 'MODULES/Register/CATALOGS/Договоры/$catalog/class.js', 'export default { label: "Договоры v2 (новый класс)" };\n');

        // Применяем автообновление до v1.0.4
        const report = applyUpdateFromDirectory({
            sourceDir: v2Source,
            rootDir: workRoot,
            newVersion: '1.0.4',
        });

        assert.equal(report.fromVersion, '1.0.3');
        assert.equal(report.toVersion, '1.0.4');
        assert.ok(report.updatedCore.includes('sources/work.js'), 'Ядро движка обновлено до v1.0.4');
        assert.ok(report.updatedClean.includes('MODULES/Register/CATALOGS/Номенклатура/$catalog/class.js'), 'Неизменённый пользователем класс обновлён');
        assert.ok(report.added.includes('MODULES/Register/CATALOGS/Договоры/$catalog/class.js'), 'Новый класс из релиза добавлен');
        assert.ok(report.preservedUserModified.includes('MODULES/Register/CATALOGS/Контрагенты/$catalog/class.js'), 'Изменённый пользователем класс сохранён!');

        // Проверяем файлы на диске после обновления
        const counterpartiesDisk = fs.readFileSync(path.join(workRoot, 'MODULES/Register/CATALOGS/Контрагенты/$catalog/class.js'), 'utf8');
        assert.ok(counterpartiesDisk.includes('customField: true'), 'Пользовательские изменения в классе сохранены');

        const nomenclatureDisk = fs.readFileSync(path.join(workRoot, 'MODULES/Register/CATALOGS/Номенклатура/$catalog/class.js'), 'utf8');
        assert.ok(nomenclatureDisk.includes('Номенклатура v2 из npm'), 'Неизменённый класс обновился');

        assert.equal(
            fs.readFileSync(path.join(workRoot, 'ORGANIZATIONS/Маслоторг/$base/#system/work.db'), 'utf8'),
            'SQLITE_USER_DATABASE_BYTES',
            'База данных организации полностью сохранена'
        );
        assert.ok(fs.existsSync(path.join(workRoot, '#system/owner-token.json')), 'Настройки и токен в #system сохранены');
        assert.ok(fs.existsSync(path.join(workRoot, 'USERS/U00000000000BOSS/$user/class.js')), 'Профиль пользователя сохранён');
    });

    it('11. Криптографическая защита от подделки license-server (Ed25519 Public Key Pinning): чужой сервер лицензий отвергается', async () => {
        // Разворачиваем сторонний («пиратский») экземпляр license-server со своей собственной парой ключей Ed25519
        const fakeHubApp = createLicenseServerApp({
            dataDir: path.join(tmpDir, 'fake-hub-data'),
            publicOrigin: 'https://fake-license.example.org',
        });
        assert.notEqual(
            fakeHubApp.store.authorityKeys.publicKey,
            hubApp.store.authorityKeys.publicKey,
            'Чужой экземпляр license-server имеет собственные ключи и не знает закрытого ключа ODANT'
        );

        // Злоумышленник регистрирует аккаунт и выпускает токен и лицензию на своём фейковом сервере
        const fakeUser = fakeHubApp.store.registerOrLoginUser({
            email: 'hacker@fake.example.org',
            companyName: 'Fake Corp',
            inn: '0000000000',
            ofertaAccepted: true,
            hubUrl: 'https://fake-license.example.org',
        });
        const fakeSummary = fakeHubApp.store.issueOrUpdateLicense({
            licenseId: fakeUser.licenseId,
            baseActivated: true,
        });
        const fakeBaseFile = fakeSummary.licenseFiles.find(f => f.kind === 'base')?.licenseFile;
        assert.ok(fakeUser.hubToken.startsWith('owk1.'));
        assert.ok(fakeBaseFile?.signature);

        // 11.1 Локальный WORK НЕ доверяет полю issuerPublicKey внутри токена/файла и проверяет только по пиннингу ключей ODANT
        assert.equal(
            verifyOwnerAccessToken(fakeUser.hubToken),
            false,
            'Токен, подписанный сторонним license-server, отвергается'
        );
        assert.equal(
            verifyLicenseFile(fakeBaseFile),
            false,
            'Файл лицензии (.lic.json), подписанный сторонним license-server, отвергается'
        );
        assert.equal(
            verifyLicenseCertificate(fakeSummary.certificate),
            false,
            'Сертификат, подписанный сторонним license-server, отвергается'
        );

        // 11.2 Попытка привязать фейковый токен к локальной системе WORK блокируется ДО сетевого обращения
        const victimSysDir = path.join(tmpDir, 'victim-system');
        fs.mkdirSync(victimSysDir, { recursive: true });
        await assert.rejects(
            () => bindOwnerTokenAndSync({
                token: fakeUser.hubToken,
                systemDir: victimSysDir,
            }),
            /подпись не принадлежит официальному центру сертификации ODANT/
        );

        // 11.3 Даже если злоумышленник вручную скопирует фейковый .lic.json и license.json в папку #system,
        // локальный WORK проигнорирует их и оставит агентскую систему и 10 мест заблокированными
        fs.writeFileSync(
            path.join(victimSysDir, 'license-base-FAKE.lic.json'),
            JSON.stringify(fakeBaseFile, null, 2),
            'utf8'
        );
        fs.writeFileSync(
            path.join(victimSysDir, 'license.json'),
            JSON.stringify(fakeSummary.certificate, null, 2),
            'utf8'
        );

        const loadedAfterAttack = loadLocalLicense(path.join(victimSysDir, 'license.json'), { systemDir: victimSysDir });
        const stateAfterAttack = evaluateLicenseState(loadedAfterAttack);
        assert.equal(stateAfterAttack.baseLicensed, false, 'Поддельные файлы лицензий в #system не активируют базовую лицензию');
        assert.equal(stateAfterAttack.aiAgentsEnabled, false, 'Агентская ИИ-система остаётся отключённой');
        assert.equal(stateAfterAttack.totalSeats, 1, 'Доступна только 1 настроечная сессия');
    });

    it('12. Личный кабинет: Реестр серверов (N устройств со своими токенами и лицензиями) и Реестр франшиз (лимит 1 на регион, таймер 15 мин ЮKassa, 12-месячный график погашения)', async () => {
        // 12.1 Регистрируем владельца в Личном кабинете
        const userReg = await fetch(`${hubUrl}/api/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: 'multi-owner@odant.org',
                companyName: 'ГК «МультиСервер и Франшиза»',
                inn: '7701992233',
                ofertaAccepted: true,
                hubUrl,
            }),
        }).then(r => r.json());

        assert.equal(userReg.servers.length, 1, 'По умолчанию создан 1-й сервер в реестре');
        const srv1 = userReg.servers[0];

        // 12.2 Пользователь самостоятельно добавляет 2-й и 3-й серверы (устройства) WORK в реестр
        const addSrv2 = await fetch(`${hubUrl}/api/cabinet/servers/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${userReg.sessionKey}` },
            body: JSON.stringify({ serverName: 'Сервер Филиал Казань', hubUrl }),
        }).then(r => r.json());
        assert.equal(addSrv2.ok, true);
        assert.equal(addSrv2.user.servers.length, 2);
        const srv2 = addSrv2.server;

        const addSrv3 = await fetch(`${hubUrl}/api/cabinet/servers/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${userReg.sessionKey}` },
            body: JSON.stringify({ serverName: 'Сервер Филиал Краснодар', hubUrl }),
        }).then(r => r.json());
        assert.equal(addSrv3.ok, true);
        assert.equal(addSrv3.user.servers.length, 3);
        const srv3 = addSrv3.server;

        // У каждого сервера свой уникальный licenseId и свой собственный токен owk1...
        assert.notEqual(srv1.licenseId, srv2.licenseId);
        assert.notEqual(srv2.licenseId, srv3.licenseId);
        assert.notEqual(srv1.hubToken, srv2.hubToken);
        assert.notEqual(srv2.hubToken, srv3.hubToken);
        assert.equal(parseOwnerAccessToken(srv2.hubToken).payload.licenseId, srv2.licenseId, 'В токене 2-го сервера зашит именно его licenseId');

        // Оформляем и оплачиваем базовую лицензию + 10 доп. мест ТОЛЬКО для 2-го сервера (Казань)
        const orderSrv2 = await fetch(`${hubUrl}/api/cabinet/orders/draft`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${userReg.sessionKey}` },
            body: JSON.stringify({
                licenseId: srv2.licenseId,
                includeBaseLicenseOnly: true,
                tier: 'business',
                addonSeats: 10,
                years: 1,
            }),
        }).then(r => r.json());
        assert.equal(orderSrv2.order.licenseId, srv2.licenseId);

        const paySrv2 = await fetch(`${hubUrl}/api/cabinet/orders/pay`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${userReg.sessionKey}` },
            body: JSON.stringify({ orderId: orderSrv2.order.orderId, paymentMethod: 'yookassa' }),
        }).then(r => r.json());

        await fetch(`${hubUrl}/api/payments/yookassa/webhook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'notification',
                event: 'payment.succeeded',
                object: {
                    id: paySrv2.paymentId,
                    status: 'succeeded',
                    amount: { value: Number(orderSrv2.order.amountRub).toFixed(2), currency: 'RUB' },
                    metadata: { orderId: orderSrv2.order.orderId, licenseId: srv2.licenseId },
                },
            }),
        });

        // Привязываем токен 2-го сервера к локальной папке #system второго устройства:
        // он получает свои 20 мест (10 вечных + 10 доп.), в то время как 1-й сервер остаётся неактивированным!
        const sysDirSrv2 = path.join(tmpDir, 'kazan-server-system');
        fs.mkdirSync(sysDirSrv2, { recursive: true });
        const syncedSrv2 = await bindOwnerTokenAndSync({
            token: srv2.hubToken,
            systemDir: sysDirSrv2,
            licensePath: path.join(sysDirSrv2, 'license.json'),
        });
        assert.equal(syncedSrv2.licenseId, srv2.licenseId);
        assert.equal(syncedSrv2.baseLicensed, true);
        assert.equal(syncedSrv2.totalSeats, 20);
        assert.equal(hubApp.store.getLicenseSummary(srv1.licenseId).baseActivated, false, '1-й сервер остался со своей отдельной (неактивированной) лицензией');

        // 12.3 Реестр франшиз: резервирование в разных регионах и запрет >1 франшизы в одном регионе
        const resTat1 = await fetch(`${hubUrl}/api/cabinet/orders/draft`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${userReg.sessionKey}` },
            body: JSON.stringify({ kind: 'franchise_reservation', regionCode: 'RU-TAT' }),
        }).then(r => r.json());
        assert.equal(resTat1.ok, true);
        assert.ok(resTat1.confirmationUrl, 'Сразу создаётся платёж ЮKassa на начальный взнос 100 000 ₽');
        assert.equal(resTat1.reservation.paymentSchedule.length, 12, 'Сформирован годовой график из 12 ежемесячных платежей');

        // Попытка зарезервировать 2-ю франшизу в том же регионе (RU-TAT) тем же пользователем отклоняется
        const resTatDup = await fetch(`${hubUrl}/api/cabinet/orders/draft`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${userReg.sessionKey}` },
            body: JSON.stringify({ kind: 'franchise_reservation', regionCode: 'RU-TAT' }),
        });
        assert.equal(resTatDup.status, 400);
        const dupErr = await resTatDup.json();
        assert.match(dupErr.error, /нельзя резервировать более 1 франшизы в одном регионе/);

        // В другом регионе (RU-KDA) этот же пользователь успешно резервирует вторую франшизу (с коротким таймером 50 мс для проверки автоотмены)
        const kdaBefore = hubApp.store.getRegionPartnerQuotaStatus('RU-KDA').vacantFranchises;
        const resKda = await fetch(`${hubUrl}/api/cabinet/orders/draft`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${userReg.sessionKey}` },
            body: JSON.stringify({ kind: 'franchise_reservation', regionCode: 'RU-KDA', depositTtlMs: 40 }),
        }).then(r => r.json());
        assert.equal(resKda.ok, true);
        assert.equal(hubApp.store.getRegionPartnerQuotaStatus('RU-KDA').vacantFranchises, kdaBefore - 1);

        // Ждём истечения таймера оплаты залога (симуляция 15 минут) -> резерв RU-KDA автоматически отменяется и освобождает слот
        await new Promise(r => setTimeout(r, 80));
        assert.equal(hubApp.store.getRegionPartnerQuotaStatus('RU-KDA').vacantFranchises, kdaBefore, 'После истечения таймера неоплаченный резерв автоматически отменён и квота освобождена');
        assert.equal(hubApp.store.state.reservations[resKda.reservation.reservationId].status, 'expired');

        // 12.4 Оплата начального взноса по франшизе RU-TAT через ЮKassa и погашение ежемесячного графика
        await fetch(`${hubUrl}/api/payments/yookassa/webhook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'notification',
                event: 'payment.succeeded',
                object: {
                    id: resTat1.paymentId,
                    status: 'succeeded',
                    amount: { value: '100000.00', currency: 'RUB' },
                    metadata: { orderId: resTat1.order.orderId, reservationId: resTat1.reservation.reservationId },
                },
            }),
        });

        const tatAfterDeposit = hubApp.store.getFranchiseSummary(resTat1.reservation.reservationId);
        assert.equal(tatAfterDeposit.depositPaid, true);
        assert.equal(tatAfterDeposit.paidMonthsCount, 0);
        assert.equal(tatAfterDeposit.totalMonthsCount, 12);

        // Оплачиваем 1-й ежемесячный платёж по графику через ЮKassa
        const payMonth1 = await fetch(`${hubUrl}/api/cabinet/franchises/pay-installment`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${userReg.sessionKey}` },
            body: JSON.stringify({
                reservationId: resTat1.reservation.reservationId,
                monthNumber: 1,
                paymentMethod: 'yookassa',
            }),
        }).then(r => r.json());
        assert.equal(payMonth1.ok, true);

        await fetch(`${hubUrl}/api/payments/yookassa/webhook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'notification',
                event: 'payment.succeeded',
                object: {
                    id: payMonth1.paymentId,
                    status: 'succeeded',
                    amount: { value: Number(payMonth1.order.amountRub).toFixed(2), currency: 'RUB' },
                    metadata: { orderId: payMonth1.order.orderId, reservationId: resTat1.reservation.reservationId },
                },
            }),
        });

        const tatAfterMonth1 = hubApp.store.getFranchiseSummary(resTat1.reservation.reservationId);
        assert.equal(tatAfterMonth1.paidMonthsCount, 1, '1-й месяц из 12 отмечен оплаченным');

        // Досрочно погашаем весь оставшийся график (месяцы 2..12)
        const payEarly = await fetch(`${hubUrl}/api/cabinet/franchises/pay-installment`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${userReg.sessionKey}` },
            body: JSON.stringify({
                reservationId: resTat1.reservation.reservationId,
                earlyPayoff: true,
                paymentMethod: 'yookassa',
            }),
        }).then(r => r.json());
        assert.equal(payEarly.ok, true);
        assert.equal(payEarly.order.amountRub, tatAfterMonth1.remainingFranchiseFeeRub);

        await fetch(`${hubUrl}/api/payments/yookassa/webhook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'notification',
                event: 'payment.succeeded',
                object: {
                    id: payEarly.paymentId,
                    status: 'succeeded',
                    amount: { value: Number(payEarly.order.amountRub).toFixed(2), currency: 'RUB' },
                    metadata: { orderId: payEarly.order.orderId, reservationId: resTat1.reservation.reservationId },
                },
            }),
        });

        const tatFinal = hubApp.store.getFranchiseSummary(resTat1.reservation.reservationId);
        assert.equal(tatFinal.paidMonthsCount, 12, 'Все 12 месяцев графика закрыты');
        assert.equal(tatFinal.remainingFranchiseFeeRub, 0, 'Остаток паушального взноса = 0 ₽');
        assert.equal(tatFinal.status, 'paid_in_full');

        // 12.5 Бессрочная сессия в браузере (wks_1...): переживает очистку памяти/перезапуск контейнера до явного нажатия «Выйти»
        assert.ok(userReg.sessionKey.startsWith('wks_1.'), 'Выпущен криптографически подписанный токен сессии');
        delete hubApp.store.state.users['multi-owner@odant.org'];
        const meAfterRestart = await fetch(`${hubUrl}/api/auth/me`, {
            headers: { 'Cookie': `odant_work_session=${encodeURIComponent(userReg.sessionKey)}` },
        }).then(r => r.json());
        assert.equal(meAfterRestart.authenticated, true, 'Сессия автоматически восстановлена из подписанного токена после перезапуска');
        assert.equal(meAfterRestart.user.email, 'multi-owner@odant.org');

        // После явного нажатия «Выйти» (/api/auth/logout) токен отзывается
        await fetch(`${hubUrl}/api/auth/logout`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${userReg.sessionKey}` },
            body: JSON.stringify({}),
        });
        const meAfterLogout = await fetch(`${hubUrl}/api/auth/me`, {
            headers: { 'Authorization': `Bearer ${userReg.sessionKey}` },
        });
        assert.equal(meAfterLogout.status, 401, 'После нажатия «Выйти» сессия завершается');
    });

    it('13. Развёртывание в чистую папку (D:\\WORK -> npx odant-work): sources/data/api.js на месте, локальные организации исключены из .npmignore, обёртка package.json защищена от ENOSELF', async () => {
        const npmIgnore = fs.readFileSync(path.resolve('C:/ODANT Web framework/web/work/.npmignore'), 'utf8');
        assert.ok(!/^data\/$/m.test(npmIgnore), 'В .npmignore нет глобального правила data/, съедавшего sources/data/*');
        assert.ok(/^\/data\/$/m.test(npmIgnore), 'В .npmignore используется корневое правило /data/');
        assert.ok(/^\/ORGANIZATIONS\/\*\/$/m.test(npmIgnore), 'В .npmignore исключены все организации из /ORGANIZATIONS/*/');
        assert.ok(/^!\/ORGANIZATIONS\/\$domain\/$/m.test(npmIgnore), 'В .npmignore оставлена только системная метапапка /ORGANIZATIONS/$domain/');

        const hostWorkDir = path.join(tmpDir, 'd-work-host');
        const pkgSourceDir = path.join(tmpDir, 'nm-odant-work');
        const writeRel = (base, rel, content) => {
            const full = path.join(base, rel);
            fs.mkdirSync(path.dirname(full), { recursive: true });
            fs.writeFileSync(full, content, 'utf8');
        };

        // Эмулируем папку D:\WORK после `npm i odant-work`
        writeRel(hostWorkDir, 'package.json', JSON.stringify({ dependencies: { 'odant-work': '^1.0.14' } }, null, 2));
        writeRel(pkgSourceDir, 'package.json', JSON.stringify({ name: 'odant-work', version: '1.0.14', type: 'module', dependencies: { ws: '^8.21.0' } }, null, 2));
        writeRel(pkgSourceDir, 'sources/data/api.js', 'export const DATA_METHODS = {};\n');
        writeRel(pkgSourceDir, '$server/$folder/class.js', 'export default { label: "v1" };\n');

        const report = applyUpdateFromDirectory({
            sourceDir: pkgSourceDir,
            rootDir: hostWorkDir,
            newVersion: '1.0.14',
        });

        assert.equal(report.toVersion, '1.0.14');
        assert.ok(fs.existsSync(path.join(hostWorkDir, 'sources/data/api.js')), 'sources/data/api.js развёрнут в рабочую папку');
        assert.ok(fs.existsSync(path.join(hostWorkDir, '$server/$folder/class.js')), '$server/$folder/class.js развёрнут в рабочую папку');
        const hostPkgAfter = JSON.parse(fs.readFileSync(path.join(hostWorkDir, 'package.json'), 'utf8'));
        assert.notEqual(hostPkgAfter.name, 'odant-work', 'Имя пакета в рабочей папке не конфликтует с odant-work (защита от npm ENOSELF)');
        assert.equal(hostPkgAfter.version, '1.0.14');

        // Пользователь модифицирует $server/$folder/class.js и проходит через ДВА обновления подряд (1.0.15 и 1.0.16)
        writeRel(hostWorkDir, '$server/$folder/class.js', 'export default { label: "user-custom-server" };\n');
        writeRel(pkgSourceDir, '$server/$folder/class.js', 'export default { label: "v2" };\n');
        const rep15 = applyUpdateFromDirectory({ sourceDir: pkgSourceDir, rootDir: hostWorkDir, newVersion: '1.0.15' });
        assert.ok(rep15.preservedUserModified.includes('$server/$folder/class.js'));

        writeRel(pkgSourceDir, '$server/$folder/class.js', 'export default { label: "v3" };\n');
        const rep16 = applyUpdateFromDirectory({ sourceDir: pkgSourceDir, rootDir: hostWorkDir, newVersion: '1.0.16' });
        assert.ok(rep16.preservedUserModified.includes('$server/$folder/class.js'), 'И на втором подряд обновлении кастомизированный файл остаётся защищённым');
        assert.ok(fs.readFileSync(path.join(hostWorkDir, '$server/$folder/class.js'), 'utf8').includes('user-custom-server'));
    });

    it('14. Шаблон организации BASE_TEMPLATE: 3 уровня создания организации (1. Пустая, 2. С типовой конфигурацией, 3. С демоданными «Моё предприятие»)', async () => {
        const {
            BASE_TEMPLATE_PRESETS,
            buildBasePassportClassJs,
            scaffoldBaseOrganizationSync,
            seedBaseTemplateDemoData,
        } = await import('../sources/server/class/base-template.js');
        const { openDataDb } = await import('../sources/data/db.js');
        const { refreshClasses, getClass } = await import('../sources/data/classes.js');
        const { queryObjects } = await import('../sources/data/objects.js');
        const { trialBalance } = await import('../sources/data/reports.js');

        assert.deepEqual(BASE_TEMPLATE_PRESETS.map(p => p.id), ['empty', 'standard', 'demo']);

        const orgsTestRoot = path.join(tmpDir, 'base-template-root');
        fs.mkdirSync(path.join(orgsTestRoot, 'ORGANIZATIONS', '$domain'), { recursive: true });
        fs.writeFileSync(path.join(orgsTestRoot, 'ORGANIZATIONS', '$domain', 'class.js'), 'export default { label: "Организации" };\n');
        // Копируем эталонные модули Register и Geo
        fs.cpSync(path.resolve('C:/ODANT Web framework/web/work/MODULES'), path.join(orgsTestRoot, 'MODULES'), { recursive: true });

        // 1) Режим «empty» (1. Пустая)
        const emptyDir = path.join(orgsTestRoot, 'ORGANIZATIONS', 'ПустаяОрг');
        fs.mkdirSync(path.join(emptyDir, '$base'), { recursive: true });
        fs.writeFileSync(path.join(emptyDir, '$base', 'class.js'), buildBasePassportClassJs({ id: 'ПустаяОрг', preset: 'empty' }));
        scaffoldBaseOrganizationSync({
            targetDir: emptyDir,
            orgId: 'ПустаяОрг',
            modulesRoot: path.join(orgsTestRoot, 'MODULES'),
            preset: 'empty',
        });
        assert.ok(fs.existsSync(path.join(emptyDir, 'MODULES', '$domain', 'class.js')));
        assert.ok(!fs.existsSync(path.join(emptyDir, 'accounting')), 'В пустой организации нет предустановленных подразделений');

        // 2) Режим «standard» (2. С типовой конфигурацией)
        const stdDir = path.join(orgsTestRoot, 'ORGANIZATIONS', 'ТиповаяОрг');
        fs.mkdirSync(path.join(stdDir, '$base'), { recursive: true });
        fs.writeFileSync(path.join(stdDir, '$base', 'class.js'), buildBasePassportClassJs({ id: 'ТиповаяОрг', preset: 'standard' }));
        scaffoldBaseOrganizationSync({
            targetDir: stdDir,
            orgId: 'ТиповаяОрг',
            modulesRoot: path.join(orgsTestRoot, 'MODULES'),
            preset: 'standard',
        });
        for (const deptId of ['administration', 'accounting', 'sales', 'purchasing', 'warehouse', 'production', 'logistics', 'hr']) {
            assert.ok(fs.existsSync(path.join(stdDir, deptId, '$structure', 'class.js')), `Создано подразделение ${deptId}`);
        }
        assert.ok(fs.existsSync(path.join(stdDir, 'MODULES', 'Register', 'REGISTER', '01', '$account', 'class.js')), 'Развёрнут полный план счетов (01..99)');
        assert.ok(fs.existsSync(path.join(stdDir, 'MODULES', 'Register', 'REGISTER', '50', '$account', 'class.js')), 'Развёрнут счёт 50 Касса');

        // 3) Режим «demo» (3. С демоданными — «Моё предприятие»)
        const demoId = 'Моё предприятие';
        const demoDir = path.join(orgsTestRoot, 'ORGANIZATIONS', demoId);
        fs.mkdirSync(path.join(demoDir, '$base'), { recursive: true });
        fs.writeFileSync(path.join(demoDir, '$base', 'class.js'), buildBasePassportClassJs({ id: demoId, preset: 'demo' }));
        scaffoldBaseOrganizationSync({
            targetDir: demoDir,
            orgId: demoId,
            modulesRoot: path.join(orgsTestRoot, 'MODULES'),
            preset: 'demo',
        });
        const seedRes = await seedBaseTemplateDemoData({ rootDir: orgsTestRoot, orgId: demoId });
        assert.equal(seedRes.seeded, true);

        const dbFile = path.join(demoDir, '$base', '#system', 'work.db');
        assert.ok(fs.existsSync(dbFile), 'Создана изолированная БД Моё предприятие/$base/#system/work.db');
        const db = await openDataDb(dbFile);
        try {
            await refreshClasses(db, orgsTestRoot);
            // Проверим, что все ссылки LINKS во всех 8 подразделениях ведут на реально существующие классы
            for (const deptId of ['administration', 'accounting', 'sales', 'purchasing', 'warehouse', 'production', 'logistics', 'hr']) {
                const cls = getClass(db, `/ORGANIZATIONS/${demoId}/${deptId}`);
                assert.ok(cls, `Класс подразделения ${deptId} загружен в БД`);
                const checkLinks = (roles) => {
                    for (const r of roles || []) {
                        assert.deepEqual(r.USERS, ['USERS']);
                        for (const l of r.LINKS || []) {
                            assert.ok(getClass(db, l.id), `Ссылка ${l.id} в ${deptId}/${r.id} указывает на существующий класс`);
                        }
                        checkLinks(r.ROLES);
                    }
                };
                checkLinks(cls.own?.['#security']?.ROLES);
            }
            const items = queryObjects(db, { cid: `/ORGANIZATIONS/${demoId}/MODULES/Register/CATALOGS/Номенклатура` });
            assert.ok(items.total >= 4, 'Справочник Номенклатура заполнен демо-объектами');
            const tb = trialBalance(db, { prefix: `/ORGANIZATIONS/${demoId}/MODULES/Register/REGISTER` });
            assert.ok(tb.rows.length >= 10, 'Оборотно-сальдовая ведомость «Моего предприятия» содержит проводки по счетам');
        }
        finally {
            db.close();
        }
    });

    it('15. Регистрация первого пользователя (BOSS) на новом компьютере без настроенного почтового сервера + горячий подхват $server/#secret/email.json', async () => {
        await import('../sources/reactor.js');
        await import('../sources/server/server.js');
        const { authMethods, uidOfEmail } = await import('../sources/host/auth-methods.js');
        const { getMailer } = await import('../sources/host/mail.js');

        const prevNoMail = process.env.WORK_NO_MAIL;
        process.env.WORK_NO_MAIL = '1';
        try {
            assert.equal(getMailer(), null, 'Почтовый сервер отключён (эмуляция чистого ПК)');
            const firstEmail = 'boss@new-pc.local';
            const firstUid = uidOfEmail(firstEmail);
            const mockServerFirst = {
                $users: Promise.resolve({ items: Promise.resolve([]) }),
            };
            const prevWork = globalThis.WORK;
            globalThis.WORK = { init: Promise.resolve(), DATA: { '#security': { BOSS: [] } } };
            try {
                const session1 = {};
                const res1 = await authMethods.user_register_start.call(mockServerFirst, {
                    post: { email: firstEmail, uid: firstUid },
                    session: session1,
                });
                assert.ok(res1 && typeof res1 === 'object' && /^\d{6}$/.test(res1.autoCode), 'Первому пользователю (BOSS) сразу возвращается autoCode для 1-клик регистрации без SMTP');
                assert.equal(session1.registration.code, res1.autoCode);

                // После того как первый BOSS зарегистрирован, второй пользователь без почтового сервера получает понятную подсказку
                const mockServerSecond = {
                    $users: Promise.resolve({ items: Promise.resolve([{ id: firstUid }]) }),
                };
                globalThis.WORK = { init: Promise.resolve(), DATA: { '#security': { BOSS: [firstUid] } } };
                await assert.rejects(
                    () => authMethods.user_register_start.call(mockServerSecond, {
                        post: { email: 'user2@new-pc.local' },
                        session: {},
                    }),
                    /Почтовый сервер не настроен/
                );
            }
            finally {
                globalThis.WORK = prevWork;
            }
        }
        finally {
            if (prevNoMail === undefined)
                delete process.env.WORK_NO_MAIL;
            else
                process.env.WORK_NO_MAIL = prevNoMail;
        }
    });

    it('16. Контур /MODELS: чистота дистрибутива (нет odant/Halogen, пустой Local), российские провайдеры (GigaChat, Yandex, T-Bank, MTS-AI), быстрое подключение внешних провайдеров и флаг aiActive', async () => {
        const {
            AI_PROVIDER_PRESETS,
            evaluateAiNodeActivitySync,
            getProviderStatusSync,
            saveProviderConfigSync,
            addProviderModelsSync,
            toggleAiNodeEnabledSync,
            scaffoldProviderOnDiskSync,
        } = await import('../sources/modules/trainer/index.js');

        // 16.1. В рабочей копии нет дублирующей ветки MODELS/Halogen, а MODELS/Local чист (только $provider)
        assert.equal(fs.existsSync('MODELS/Halogen'), false, 'Дублирующая ветка MODELS/Halogen удалена (объединена с MODELS/Local)');
        const localEntries = fs.readdirSync('MODELS/Local').filter(n => !n.startsWith('$') && !n.startsWith('#'));
        assert.deepEqual(localEntries, [], 'В чистой поставке папка MODELS/Local пуста');

        // 16.2. В .npmignore исключены /MODELS/odant/ и локальные модели /MODELS/Local/*/
        const npmignore = fs.readFileSync('.npmignore', 'utf-8');
        assert.match(npmignore, /^\/MODELS\/odant\/$/m, '.npmignore исключает внутренний провайдер /MODELS/odant/');
        assert.match(npmignore, /^\/MODELS\/Local\/\*\/$/m, '.npmignore исключает скачанные локальные модели из /MODELS/Local/*/');
        assert.match(npmignore, /^!\/MODELS\/Local\/\$provider\/$/m, '.npmignore сохраняет метапапку /MODELS/Local/$provider/');

        // 16.3. Российские провайдеры (GigaChat, Yandex, T-Bank, MTS-AI) предустановлены со всеми моделями и без зашитых токенов
        for (const provId of ['GigaChat', 'Yandex', 'T-Bank', 'MTS-AI']) {
            assert.ok(fs.existsSync(path.join('MODELS', provId, '$provider', 'class.js')), `Провайдер /MODELS/${provId} предустановлен`);
            const secretDir = path.join('MODELS', provId, '$provider', '#secret');
            const secretFiles = fs.existsSync(secretDir) ? fs.readdirSync(secretDir) : [];
            assert.equal(secretFiles.length, 0, `У провайдера /MODELS/${provId} нет зашитых секретных токенов в дистрибутиве`);
        }

        // Проверим полный состав моделей GigaChat и Yandex
        const gigaDirs = fs.readdirSync('MODELS/GigaChat').filter(n => !n.startsWith('$'));
        assert.ok(gigaDirs.includes('GigaChat 2 Lite') && gigaDirs.includes('GigaChat 2 Pro') && gigaDirs.includes('GigaChat 2 Max') && gigaDirs.includes('GigaChat Embeddings'));
        const yandexDirs = fs.readdirSync('MODELS/Yandex').filter(n => !n.startsWith('$'));
        assert.ok(yandexDirs.includes('Alice AI (YandexGPT 5 Pro)') && yandexDirs.includes('YandexGPT 5 Lite') && yandexDirs.includes('YandexGPT Reasoning') && yandexDirs.includes('YandexART'));

        // 16.4. Проверка индикации активности (aiActive) и быстрого подключения провайдера на изолированном стенде
        const aiTmp = path.join(tmpDir, 'ai-test-root');
        fs.mkdirSync(path.join(aiTmp, 'MODELS', 'Local', '$provider'), { recursive: true });
        scaffoldProviderOnDiskSync({ rootDir: aiTmp, providerId: 'GigaChat', presetId: 'GigaChat', includeDefaultModels: true });
        scaffoldProviderOnDiskSync({ rootDir: aiTmp, providerId: 'Yandex', presetId: 'Yandex', includeDefaultModels: true });
        scaffoldProviderOnDiskSync({ rootDir: aiTmp, providerId: 'OpenAI', presetId: 'OpenAI', includeDefaultModels: true });

        // Без ключа провайдер неактивен (aiActive === false)
        const gigaMock = { id: 'GigaChat', type: '$provider', path: '/MODELS/GigaChat', DATA: { protocol: 'gigachat', token: 'secret:gigachat.json' } };
        const actBefore = evaluateAiNodeActivitySync(gigaMock, aiTmp);
        assert.equal(actBefore.active, false, 'Без настроенного ключа GigaChat помечен как неактивный');

        // Сохраняем ключ через saveProviderConfigSync — провайдер и его модели сразу становятся активными (aiActive === true)
        saveProviderConfigSync({ rootDir: aiTmp, providerId: 'GigaChat', apiKey: 'test-giga-oauth-token-123456', protocol: 'gigachat' });
        const actAfter = evaluateAiNodeActivitySync(gigaMock, aiTmp);
        assert.equal(actAfter.active, true, 'После сохранения ключа GigaChat помечен как активный');

        const stGiga = getProviderStatusSync(gigaMock, aiTmp);
        assert.equal(stGiga.active, true);
        assert.equal(stGiga.hasKey, true);
        assert.equal(stGiga.installedModels.length, 4);
        assert.ok(stGiga.installedModels.every(m => m.active === true), 'Все 4 модели GigaChat активны');

        // Отключаем одну модель через toggleAiNodeEnabledSync — она становится неактивной
        toggleAiNodeEnabledSync({ rootDir: aiTmp, nodePath: '/MODELS/GigaChat/GigaChat 2 Lite', enabled: false });
        const stGigaAfterToggle = getProviderStatusSync(gigaMock, aiTmp);
        const liteModel = stGigaAfterToggle.installedModels.find(m => m.id === 'GigaChat 2 Lite');
        assert.equal(liteModel.enabled, false);
        assert.equal(liteModel.active, false, 'Отключённая модель помечается как неактивная');

        // Добавление новой модели в провайдер в 1 клик
        addProviderModelsSync({
            rootDir: aiTmp,
            providerId: 'OpenAI',
            models: [{ id: 'GPT-4.5 Preview', label: 'GPT-4.5 Preview', model: 'gpt-4.5-preview' }],
        });
        assert.ok(fs.existsSync(path.join(aiTmp, 'MODELS', 'OpenAI', 'GPT-4.5 Preview', '$ai', 'class.js')), 'Произвольная модель добавлена в провайдер');
        assert.ok(AI_PROVIDER_PRESETS.length >= 10, 'Каталог шаблонов внешних провайдеров содержит основные мировые и российские облака');
    });
});
