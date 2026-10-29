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
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
    PAK_HARDWARE_SPEC,
    SUPPORT_TIERS,
    verifyLicenseCertificate,
    evaluateLicenseState,
    getActiveWorkplaces,
    assertWorkplaceAvailableForLogin,
    calculateLicenseQuote,
    inspectPreinstalledModels,
    syncWithLicenseHub,
    createHubCheckoutOrder,
} from '../sources/modules/license/index.js';

import {
    PAK_PRODUCT,
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
    });

    after(async () => {
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
            assert.equal(m.configured, true, `Дескриптор модели ${m.id} должен быть предустановлен в /MODELS/Local`);
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

    it('7. Лендинг ODANT-WORK (work.odant.org): тёмная/светлая тема, карта России, скрытие докупки до входа и собственный ИИ-агент', async () => {
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
        assert.ok(html.includes('id="admAgentCard"') && html.includes('data-adm-tab="agent"'), 'ИИ-агент интегрирован на левую вкладку админки');
        assert.ok(html.includes('через API из любого источника'), 'Указано подключение более мощных моделей ИИ через API из любого источника');
        assert.ok(!html.includes('1С'), 'В лендинге нет упоминаний 1С');

        // Авторизация пользователя для доступа к докупке лицензий
        const authRes = await fetch(`${hubUrl}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'director@maslotorg.ru', companyName: 'ООО «Маслоторг»' }),
        }).then(r => r.json());
        assert.ok(authRes.sessionKey);
        assert.ok(authRes.licenseId);

        // Запрос к собственному ИИ-агенту сервера лицензий
        const agentReply = await fetch(`${hubUrl}/api/agent/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: 'Рассчитай 25 мест Business', sessionKey: authRes.sessionKey }),
        }).then(r => r.json());
        assert.ok(agentReply.reply.includes('−15%'));
        assert.equal(agentReply.data.quote.volumeDiscountPercent, 15);

        // Запрос к ИИ-агенту из админки: сводка по серверу
        const admSummary = await fetch(`${hubUrl}/api/agent/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: 'Сводка по серверу лицензий', sessionKey: authRes.sessionKey }),
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
        const reserveRes = await fetch(`${hubUrl}/api/partners/reserve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                regionCode: 'RU-SVE',
                companyName: 'ООО «УралФраншиза»',
                inn: '6670998877',
                email: 'ceo@uralfranchise.ru',
            }),
        }).then(r => r.json());
        assert.equal(reserveRes.amountRub, 100_000, 'Сразу за резервирование выставляется невозвратный залог 100 000 ₽');
        assert.equal(reserveRes.regionQuota.vacantFranchises, sveBefore.vacantFranchises - 1, 'Количество вакантных франшиз региона уменьшается на 1 при резервировании');

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
});
