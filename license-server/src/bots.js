/**
 * Омниканальный шлюз ботов технической поддержки ПАК WORK для мессенджеров:
 *  - MAX (https://botapi.max.ru)
 *  - Telegram (https://api.telegram.org)
 *  - VK (https://api.vk.com/method)
 *
 * Возможности:
 *  - Привязка чата к лицензии ПАК клиента (/bind <код_или_номер_лицензии>);
 *  - Сводка по ПАК, рабочим местам (5 вечных + годовые) и текущему уровню SLA (/status);
 *  - Докупка годовых пользовательских лицензий Start / Business / Enterprise через ЮKassa (/buy);
 *  - Приём обращений в техподдержку с проверкой квоты обращений и расчётом времени реакции по SLA:
 *      Start (15 000 ₽/год)      — до 12 обращений/год на место, реакция до 8 раб. часов;
 *      Business (40 000 ₽/год)   — до 48 обращений/год на место, реакция до 2 часов;
 *      Enterprise (100 000 ₽/год) — безлимит обращений, реакция до 15 минут (24/7);
 *  - Отправка ответов инженеров и уведомлений об успешной оплате обратно в MAX / Telegram / VK.
 */
import { SLA_TIERS } from './catalog.js';

export class SupportBotsHub {
    constructor({
        store,
        yookassa,
        maxBotSecret = process.env.MAX_BOT_TOKEN || '',
        telegramBotSecret = process.env.TELEGRAM_BOT_TOKEN || '',
        vkBotSecret = process.env.VK_BOT_TOKEN || '',
        vkConfirmationCode = process.env.VK_CONFIRMATION_CODE || 'work_vk_confirm',
        publicOrigin = process.env.PUBLIC_ORIGIN || 'https://work.odant.org',
        fetchImpl = globalThis.fetch,
    } = {}) {
        this.store = store;
        this.yookassa = yookassa;
        this.maxBotSecret = maxBotSecret;
        this.telegramBotSecret = telegramBotSecret;
        this.vkBotSecret = vkBotSecret;
        this.vkConfirmationCode = vkConfirmationCode;
        this.publicOrigin = String(publicOrigin).replace(/\/+$/, '');
        this.fetchImpl = fetchImpl;
        this.outboxLog = [];
        this.adminOutboxLog = [];
        this._tgUpdateOffset = 0;
        this._maxMarker = null;
        this._pollTimer = null;
        this._polling = false;
    }

    /**
     * Универсальная обработка входящего сообщения от пользователя из любого мессенджера (max | telegram | vk).
     */
    async handleIncomingMessage({ channel, chatId, userName = 'Клиент', text = '', originOverride = '' }) {
        const ch = String(channel || 'telegram').toLowerCase();
        const cid = String(chatId || 'demo-chat');
        const cleanText = String(text || '').trim();

        if (!cleanText || /^\/(start|help|помощь)$/i.test(cleanText)) {
            const isAdmin = this.store.isAdminBotChat?.(ch, cid);
            const bound = this.store.getBoundLicenseForChat(ch, cid);
            const lines = [
                `Здравствуйте, ${userName}! Это служба поддержки и лицензирования ODANT-WORK · ООО «БИС» (${ch.toUpperCase()}).`,
                bound
                    ? `Ваш чат привязан к лицензии: ${bound.licenseId} (${bound.customer?.name || 'ODANT-WORK'}, уровень ${bound.support.tierName}, мест: ${bound.totalSeats}).`
                    : 'Для клиентской работы привяжите ваш ПАК WORK командой:\n/bind <НОМЕР_ЛИЦЕНЗИИ_ИЛИ_КОД>',
                '',
                'Доступные команды:',
                '• /bind <КОД> — привязать ПАК WORK к этому чату',
                '• /status — проверить рабочие места (10 вечных + годовые), SLA и остаток обращений',
                '• /buy <start|business|enterprise> <кол-во_мест> — докупить годовые лицензии через ЮKassa',
                '• /admin <КОД> — привязать чат администратора (код из /admin → Боты)',
                '• Любое другое сообщение — создать обращение в инженерную поддержку по вашему SLA.',
            ];
            if (isAdmin) {
                lines.push('', 'Команды администратора:', '• /stats — сводка по клиентам, заказам и франшизам', '• /orders — последние заказы', '• /franchises — активные франшизы и резервы');
            }
            const greeting = lines.join('\n');
            await this.sendExternalMessage(ch, cid, greeting);
            return { action: 'help', reply: greeting };
        }

        // Команда /admin <код> (или /admin_bind <код>) — привязка админ-чата MAX / Telegram
        const adminBindMatch = cleanText.match(/^\/(?:admin|admin_bind)\s+(\S+)/i);
        if (adminBindMatch) {
            const code = adminBindMatch[1].trim();
            if (ch !== 'max' && ch !== 'telegram') {
                const reply = 'Административные уведомления поддерживаются только для MAX и Telegram.';
                await this.sendExternalMessage(ch, cid, reply);
                return { action: 'admin_bind', ok: false, reply };
            }
            try {
                const chats = this.store.consumeAdminBotBindCode(code, { channel: ch, chatId: cid, userName });
                const reply = [
                    `Чат (${ch.toUpperCase()}, ID: ${cid}) успешно привязан к Админ-панели ODANT-WORK (ООО «БИС»)!`,
                    'Теперь вы будете мгновенно получать уведомления о:',
                    '• регистрациях пользователей;',
                    '• новых заявках и заказах;',
                    '• поступлениях оплат (ЮKassa и безнал);',
                    '• выдачах и активациях лицензий;',
                    '• резервированиях и активациях франшиз.',
                    '',
                    'Админ-команды: /stats · /orders · /franchises',
                ].join('\n');
                await this.sendExternalMessage(ch, cid, reply);
                return { action: 'admin_bind', ok: true, channel: ch, chatId: cid, adminChatsCount: chats.length, reply };
            }
            catch (err) {
                const reply = `Ошибка привязки админ-чата: ${err.message || err}`;
                await this.sendExternalMessage(ch, cid, reply);
                return { action: 'admin_bind', ok: false, reply };
            }
        }

        // Админ-команды чтения сводки (/stats, /orders, /franchises)
        if (/^\/(stats|orders|franchises)$/i.test(cleanText)) {
            if (!this.store.isAdminBotChat?.(ch, cid)) {
                const reply = 'Команда доступна только привязанным админ-чатам. Получите код в /admin → Боты и отправьте /admin <КОД>.';
                await this.sendExternalMessage(ch, cid, reply);
                return { action: 'admin_denied', ok: false, reply };
            }
            const cmd = cleanText.slice(1).toLowerCase();
            if (cmd === 'stats') {
                const counts = this.store.getStoreCounts?.() || {};
                const lics = this.store.listLicenses?.() || [];
                const orders = Object.values(this.store.state?.orders || {});
                const paidOrders = orders.filter(o => o && o.status === 'paid');
                const pendingOrders = orders.filter(o => o && o.status === 'pending');
                const totalRevenueRub = paidOrders.reduce((s, o) => s + Number(o.amountRub || 0), 0);
                const frs = (this.store.listAllFranchises?.() || []).filter(f => f.status !== 'canceled' && f.status !== 'expired');
                const openTickets = (this.store.listTickets?.() || []).filter(t => t.status === 'open').length;
                const reply = [
                    'Сводка ODANT-WORK · ООО «БИС»:',
                    `• Пользователей: ${counts.users ?? 0}`,
                    `• Серверов/лицензий: ${lics.length} (активных базовых: ${lics.filter(l => l.baseActivated).length})`,
                    `• Оплачено заказов: ${paidOrders.length} на сумму ${totalRevenueRub.toLocaleString('ru-RU')} ₽`,
                    `• Ожидают оплаты: ${pendingOrders.length}`,
                    `• Активных франшиз/партнёров: ${(this.store.listPartners?.() || []).filter(p => p.status === 'active').length} (резервов/графиков: ${frs.length})`,
                    `• Открытых тикетов: ${openTickets}`,
                    `Админ-панель: ${this.publicOrigin}/admin`,
                ].join('\n');
                await this.sendExternalMessage(ch, cid, reply);
                return { action: 'admin_stats', ok: true, reply };
            }
            if (cmd === 'orders') {
                const orders = Object.values(this.store.state?.orders || {})
                    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
                    .slice(0, 8);
                const lines = orders.length
                    ? orders.map(o => `• ${o.orderId} · ${Number(o.amountRub || 0).toLocaleString('ru-RU')} ₽ · ${o.status === 'paid' ? 'ОПЛАЧЕН' : (o.status === 'canceled' ? 'ОТМЕНЁН' : 'ЖДЁТ')} · ${o.customer?.name || o.customer?.email || '—'}`)
                    : ['Заказов пока нет.'];
                const reply = ['Последние заказы ODANT-WORK:', ...lines].join('\n');
                await this.sendExternalMessage(ch, cid, reply);
                return { action: 'admin_orders', ok: true, reply };
            }
            if (cmd === 'franchises') {
                const frs = (this.store.listAllFranchises?.() || []).filter(f => f.status !== 'canceled' && f.status !== 'expired').slice(0, 10);
                const lines = frs.length
                    ? frs.map(f => `• ${f.regionName} (${f.reservationId}) · ${f.companyName || f.email} · ${f.depositPaid ? `залог ✓, оплачено ${f.paidMonthsCount}/12` : 'ожидает залога 100 000 ₽'}${f.partnerId ? ` · партнёр ${f.partnerId}` : ''}`)
                    : ['Активных франшиз и резервов нет.'];
                const reply = ['Региональные франшизы ODANT-WORK:', ...lines].join('\n');
                await this.sendExternalMessage(ch, cid, reply);
                return { action: 'admin_franchises', ok: true, reply };
            }
        }

        // Команда /bind <код>
        const bindMatch = cleanText.match(/^\/(?:bind|привязать)\s+(\S+)/i);
        if (bindMatch) {
            const code = bindMatch[1].trim();
            try {
                const lic = this.store.bindBotChat({
                    channel: ch,
                    chatId: cid,
                    userName,
                    codeOrLicenseId: code,
                });
                const reply = [
                    `Чат (${ch.toUpperCase()}) успешно привязан к ПАК WORK!`,
                    `• Лицензия: ${lic.licenseId}`,
                    `• Организация: ${lic.customer?.name || '—'}`,
                    `• Платформа: ${lic.hardware?.cpu || 'AMD Ryzen™ AI Max+ PRO 495'} (${lic.hardware?.ramGb || 192} ГБ RAM, SSD ${lic.hardware?.ssdTb || 4} ТБ)`,
                    `• Рабочие места: ${lic.totalSeats} (${lic.baseSeats} вечных + ${lic.addonSeats} годовых)`,
                    `• Уровень поддержки: ${lic.support.tierName} (время реакции ${lic.support.reactionLabel})`,
                    `• Остаток обращений: ${lic.support.ticketsRemaining} из ${lic.support.ticketsQuota}`,
                ].join('\n');
                await this.sendExternalMessage(ch, cid, reply);
                return { action: 'bind', ok: true, licenseId: lic.licenseId, reply };
            }
            catch (err) {
                const reply = `Ошибка привязки: ${err.message || err}`;
                await this.sendExternalMessage(ch, cid, reply);
                return { action: 'bind', ok: false, reply };
            }
        }

        // Команда /status
        if (/^\/(status|статус)$/i.test(cleanText)) {
            const lic = this.store.getBoundLicenseForChat(ch, cid);
            if (!lic) {
                const reply = 'Чат ещё не привязан к лицензии ПАК. Отправьте /bind <НОМЕР_ЛИЦЕНЗИИ_ИЛИ_КОД>.';
                await this.sendExternalMessage(ch, cid, reply);
                return { action: 'status', ok: false, reply };
            }
            const reply = [
                `Статус лицензии ПАК WORK: ${lic.licenseId}`,
                `• Оборудование: ${lic.hardware?.cpu || 'AMD Ryzen™ AI Max+ PRO 495'} · ${lic.hardware?.ramGb || 192} ГБ RAM · SSD ${lic.hardware?.ssdTb || 4} ТБ`,
                `• HWID: ${lic.hardware?.hwid || '—'}`,
                `• Доступно одновременных сессий: ${lic.totalSeats} (${lic.baseSeats} вечных + ${lic.addonSeats} срочных годовых)`,
                `• Уровень SLA поддержки: ${lic.support.tierName} (${lic.support.scheduleLabel})`,
                `• Гарантированное время реакции: ${lic.support.reactionLabel}`,
                `• Доступно обращений в этом году: ${lic.support.ticketsRemaining} из ${lic.support.ticketsQuota}`,
            ].join('\n');
            await this.sendExternalMessage(ch, cid, reply);
            return { action: 'status', ok: true, license: lic, reply };
        }

        // Команда /buy <start|business|enterprise> [seats] [years]
        const buyMatch = cleanText.match(/^\/(?:buy|купить)\s*(?:(start|business|enterprise))?\s*(\d+)?\s*(\d+)?/i);
        if (buyMatch) {
            const lic = this.store.getBoundLicenseForChat(ch, cid);
            if (!lic) {
                const reply = 'Сначала привяжите ваш ПАК командой /bind <НОМЕР_ЛИЦЕНЗИИ>, чтобы докупить рабочие места.';
                await this.sendExternalMessage(ch, cid, reply);
                return { action: 'buy', ok: false, reply };
            }
            const tierKey = (buyMatch[1] || 'business').toLowerCase();
            const seats = Math.max(1, Number(buyMatch[2] || 1));
            const years = Math.max(1, Math.min(5, Number(buyMatch[3] || 1)));
            const tierSpec = SLA_TIERS[tierKey] || SLA_TIERS.business;

            const order = this.store.createOrder({
                licenseId: lic.licenseId,
                tier: tierSpec.id,
                addonSeats: seats,
                years,
                customer: lic.customer,
            });
            const payment = await this.yookassa.createPaymentForOrder(order, { originOverride });
            const reply = [
                `Сформирован счёт ЮKassa (${order.orderId}) для лицензии ${lic.licenseId}:`,
                `• Тариф поддержки: ${tierSpec.name} (${tierSpec.pricePerUserYearRub.toLocaleString('ru-RU')} ₽/год за 1 место)`,
                `• Доп. рабочих мест: ${seats} на ${years} г.`,
                `• Сумма к оплате: ${order.amountRub.toLocaleString('ru-RU')} ₽`,
                `• Ссылка на оплату ЮKassa: ${payment.confirmationUrl}`,
            ].join('\n');
            await this.sendExternalMessage(ch, cid, reply);
            return { action: 'buy', ok: true, orderId: order.orderId, confirmationUrl: payment.confirmationUrl, reply };
        }

        // Обычное сообщение -> создание тикета техподдержки с контролем SLA и лимита обращений
        const lic = this.store.getBoundLicenseForChat(ch, cid);
        if (!lic) {
            const reply = 'Для отправки обращения в техподдержку сначала привяжите ваш ПАК WORK командой:\n/bind <НОМЕР_ЛИЦЕНЗИИ_ИЛИ_КОД>';
            await this.sendExternalMessage(ch, cid, reply);
            return { action: 'unauthenticated', ok: false, reply };
        }

        try {
            const { ticket, license: updatedLic } = this.store.createSupportTicket({
                licenseId: lic.licenseId,
                channel: ch,
                chatId: cid,
                userName,
                text: cleanText,
            });
            const reply = [
                `Обращение ${ticket.ticketId} зарегистрировано!`,
                `• Тариф SLA: ${ticket.tierName} (гарантированное время реакции: ${ticket.reactionLabel})`,
                `• Остаток обращений по вашей квоте: ${updatedLic.support.ticketsRemaining} из ${updatedLic.support.ticketsQuota}`,
                'Инженер поддержки ответит вам прямо в этот чат.',
            ].join('\n');
            await this.sendExternalMessage(ch, cid, reply);
            await this.notifyAdmins('ticket_created', { ticket }).catch(() => {});
            return { action: 'ticket_created', ok: true, ticket, reply };
        }
        catch (err) {
            const reply = `Обращение не создано: ${err.message || err}`;
            await this.sendExternalMessage(ch, cid, reply);
            return { action: 'ticket_quota_exceeded', ok: false, reply };
        }
    }

    /**
     * Разбор нативного Webhook от мессенджера MAX (https://botapi.max.ru).
     */
    async handleMaxWebhook(payload = {}, originOverride = '') {
        const msg = payload.message || {};
        const sender = msg.sender || payload.user || {};
        const recipient = msg.recipient || {};
        const chatId = String(recipient.chat_id || sender.user_id || payload.chat_id || 'max-chat');
        const userName = String(sender.name || sender.username || 'Пользователь MAX');
        const text = String(msg.body?.text ?? payload.text ?? '');
        return this.handleIncomingMessage({ channel: 'max', chatId, userName, text, originOverride });
    }

    /**
     * Разбор нативного Webhook от Telegram Bot API.
     */
    async handleTelegramWebhook(payload = {}, originOverride = '') {
        const msg = payload.message || payload.edited_message || payload.callback_query?.message || {};
        const from = msg.from || payload.callback_query?.from || {};
        const chatId = String(msg.chat?.id || from.id || 'tg-chat');
        const userName = [from.first_name, from.last_name].filter(Boolean).join(' ') || from.username || 'Пользователь Telegram';
        const text = String(payload.callback_query?.data || msg.text || payload.text || '');
        return this.handleIncomingMessage({ channel: 'telegram', chatId, userName, text, originOverride });
    }

    /**
     * Разбор нативного Webhook от VK Callback API.
     */
    async handleVkWebhook(payload = {}, originOverride = '') {
        if (payload.type === 'confirmation') {
            return { isVkConfirmation: true, body: this.vkConfirmationCode };
        }
        const obj = payload.object?.message || payload.object || {};
        const chatId = String(obj.peer_id || obj.from_id || payload.chat_id || 'vk-chat');
        const userName = String(payload.user_name || `VK #${obj.from_id || 'user'}`);
        const text = String(obj.text || payload.text || '');
        const result = await this.handleIncomingMessage({ channel: 'vk', chatId, userName, text, originOverride });
        return { isVkConfirmation: false, result, body: 'ok' };
    }

    /**
     * Мгновенно отправить структурированное уведомление всем привязанным админ-чатам (MAX и Telegram).
     */
    async notifyAdmins(eventType, data = {}) {
        const chats = this.store?.getAdminBotChats?.() || [];
        const fmtRub = (n) => `${Number(n || 0).toLocaleString('ru-RU')} ₽`;
        let text = '';

        switch (eventType) {
            case 'registration': {
                const email = data.email || '—';
                const company = data.companyName && !String(data.companyName).includes('@') ? data.companyName : '';
                text = [
                    '🆕 Новая регистрация на ODANT-WORK (ООО «БИС»)',
                    `• Email: ${email}`,
                    company ? `• Организация: ${company}` : '',
                    data.inn ? `• ИНН: ${data.inn}` : '',
                    data.licenseId ? `• Выделенный сервер: ${data.licenseId}` : '',
                    `• Оферта ПЭП: ${data.ofertaAccepted ? 'принята' : 'ожидает'}`,
                ].filter(Boolean).join('\n');
                break;
            }
            case 'order_created': {
                const o = data.order || data;
                const kindLabel = o.kind === 'franchise_reservation'
                    ? `Бронь франшизы (${o.regionName || o.regionCode}) — невозвратный залог`
                    : o.kind === 'franchise_installment'
                        ? `Погашение франшизы (${o.regionName || o.regionCode})`
                        : (o.tierName || 'Заказ лицензий');
                text = [
                    '📝 Новая заявка / заказ на ODANT-WORK',
                    `• Заказ: ${o.orderId || '—'}`,
                    `• Назначение: ${kindLabel}`,
                    `• Сумма: ${fmtRub(o.amountRub)}`,
                    `• Способ оплаты: ${o.paymentMethod === 'invoice' ? 'Счёт-договор (безнал)' : 'ЮKassa'}`,
                    `• Плательщик: ${o.customer?.name || o.customer?.email || '—'}${o.customer?.inn ? ` (ИНН ${o.customer.inn})` : ''}`,
                ].filter(Boolean).join('\n');
                break;
            }
            case 'payment_received': {
                const o = data.order || data;
                text = [
                    '💳 Получена оплата!',
                    `• Заказ: ${o.orderId || '—'}`,
                    `• Сумма: ${fmtRub(o.amountRub)}`,
                    `• Канал: ${o.paymentMethod === 'invoice' ? 'Безналичный счёт' : 'ЮKassa'}${o.paymentId ? ` (${o.paymentId})` : ''}`,
                    `• Плательщик: ${o.customer?.name || o.customer?.email || '—'}${o.customer?.inn ? ` (ИНН ${o.customer.inn})` : ''}`,
                    data.source ? `• Подтверждение: ${data.source}` : '',
                ].filter(Boolean).join('\n');
                break;
            }
            case 'license_issued': {
                const lic = data.license || data;
                text = [
                    '🔑 Выдача / активация лицензии ODANT-WORK',
                    `• Сервер (License ID): ${lic.licenseId || '—'}`,
                    `• Статус базы (10 вечных): ${lic.baseActivated ? 'АКТИВНА' : 'не активирована'}`,
                    `• Всего рабочих мест: ${lic.totalSeats ?? 0} (${lic.baseSeats || 0} вечных + ${lic.addonSeats || 0} годовых)`,
                    lic.support?.tierName ? `• Тариф SLA: ${lic.support.tierName}` : '',
                    lic.hardware?.hwid ? `• HWID: ${lic.hardware.hwid}${lic.hardware.hwidBound ? ' (привязан)' : ''}` : '',
                    lic.customer?.name || lic.ownerEmail ? `• Клиент: ${lic.customer?.name || lic.ownerEmail}` : '',
                    data.source ? `• Источник: ${data.source}` : '',
                ].filter(Boolean).join('\n');
                break;
            }
            case 'franchise_activated': {
                const fr = data.reservation || data.franchise || data;
                const prt = data.partner || null;
                text = [
                    '🏛️ Активация / оплата региональной франшизы',
                    `• Регион: ${fr.regionName || fr.regionCode || '—'} (${fr.reservationId || '—'})`,
                    prt?.partnerId || fr.partnerId ? `• Партнёр ID: ${prt?.partnerId || fr.partnerId} (скидка ${prt?.discountPercent ?? fr.partnerDiscountPercent ?? 10}%)` : '',
                    `• Компания: ${fr.companyName || fr.email || '—'}${fr.inn ? ` (ИНН ${fr.inn})` : ''}`,
                    `• Невозвратный залог: ${fmtRub(fr.nonRefundableDepositRub || 100_000)} (${fr.depositPaid ? 'ОПЛАЧЕН' : 'ожидает'})`,
                    `• Оплачено всего: ${fmtRub(fr.totalPaidRub)} из ${fmtRub(fr.franchiseFeeRub)} (остаток: ${fmtRub(fr.remainingFranchiseFeeRub)})`,
                    `• График 12 мес.: закрыто ${fr.paidMonthsCount || 0} / 12`,
                    data.source ? `• Источник: ${data.source}` : '',
                ].filter(Boolean).join('\n');
                break;
            }
            case 'franchise_canceled': {
                const fr = data.franchise || data;
                text = [
                    '⚠️ Франшиза отозвана / отменена',
                    `• Регион: ${fr.regionName || fr.regionCode || '—'} (${fr.reservationId || '—'})`,
                    `• Компания: ${fr.companyName || fr.email || '—'}`,
                    '• Квота субъекта РФ освобождена (уплаченный залог не возвращается).',
                ].filter(Boolean).join('\n');
                break;
            }
            case 'ticket_created': {
                const t = data.ticket || data;
                const firstMsg = t.messages?.[t.messages.length - 1]?.text || '';
                text = [
                    '🎫 Новое обращение в техподдержку',
                    `• Тикет: ${t.ticketId || '—'} (${String(t.channel || '').toUpperCase()})`,
                    `• Клиент: ${t.customerName || t.userName || '—'} (сервер ${t.licenseId || '—'})`,
                    `• SLA: ${t.tierName || 'Start'} (${t.reactionLabel || ''})`,
                    firstMsg ? `• Сообщение: ${firstMsg.slice(0, 300)}` : '',
                ].filter(Boolean).join('\n');
                break;
            }
            case 'test': {
                text = `✅ Тестовое уведомление Админ-панели ODANT-WORK (ООО «БИС»).\nСвязь с сервером ${this.publicOrigin} работает корректно.`;
                break;
            }
            default: {
                text = String(data.text || `Событие ODANT-WORK (${eventType})`);
            }
        }

        const record = { eventType, text, time: Date.now(), deliveries: [] };
        this.adminOutboxLog.push(record);
        if (this.adminOutboxLog.length > 100)
            this.adminOutboxLog.shift();

        for (const c of chats) {
            const sent = await this.sendExternalMessage(c.channel, c.chatId, text);
            record.deliveries.push(sent);
        }
        return record;
    }

    /**
     * Уведомить все привязанные чаты (MAX, Telegram, VK) об успешной оплате и продлении лицензии.
     */
    async notifyLicenseOrderPaid(order, licenseSummary) {
        const bindings = this.store.getBindingsForLicense(licenseSummary.licenseId);
        const text = [
            `Оплата по заказу ${order.orderId} (${order.amountRub.toLocaleString('ru-RU')} ₽) успешно получена!`,
            `• Лицензия ПАК: ${licenseSummary.licenseId}`,
            `• Доступно одновременных рабочих мест: ${licenseSummary.totalSeats} (${licenseSummary.baseSeats} вечных + ${licenseSummary.addonSeats} годовых)`,
            `• Уровень поддержки: ${licenseSummary.support.tierName} (реакция ${licenseSummary.support.reactionLabel})`,
            `• Доступно обращений: ${licenseSummary.support.ticketsRemaining} из ${licenseSummary.support.ticketsQuota}`,
        ].join('\n');
        for (const b of bindings) {
            await this.sendExternalMessage(b.channel, b.chatId, text);
        }
    }

    /**
     * Доставить ответ инженера поддержки в мессенджер клиента (MAX, Telegram, VK).
     */
    async deliverEngineerReply(ticket) {
        const lastMsg = ticket.messages[ticket.messages.length - 1];
        if (!lastMsg)
            return;
        const text = [
            `Ответ по обращению ${ticket.ticketId} (${lastMsg.author}):`,
            lastMsg.text,
        ].join('\n\n');
        await this.sendExternalMessage(ticket.channel, ticket.chatId, text);
    }

    /**
     * Отправить сообщение во внешний мессенджер (MAX / Telegram / VK) и записать в журнал outboxLog.
     */
    async sendExternalMessage(channel, chatId, text) {
        const entry = {
            channel: String(channel).toLowerCase(),
            chatId: String(chatId),
            text: String(text),
            time: Date.now(),
            deliveredRemote: false,
        };
        this.outboxLog.push(entry);
        if (this.outboxLog.length > 200)
            this.outboxLog.shift();

        if (typeof this.fetchImpl !== 'function')
            return entry;

        try {
            if (entry.channel === 'telegram' && this.telegramBotSecret) {
                const url = `https://api.telegram.org/bot${this.telegramBotSecret}/sendMessage`;
                const res = await this.fetchImpl(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ chat_id: entry.chatId, text: entry.text }),
                    signal: AbortSignal.timeout(4000),
                });
                entry.deliveredRemote = res.ok;
            }
            else if (entry.channel === 'max' && this.maxBotSecret) {
                let url = `https://botapi.max.ru/messages?chat_id=${encodeURIComponent(entry.chatId)}`;
                let res = await this.fetchImpl(url, {
                    method: 'POST',
                    headers: {
                        'Authorization': this.maxBotSecret,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ text: entry.text }),
                    signal: AbortSignal.timeout(4000),
                });
                if (!res.ok) {
                    url = `https://botapi.max.ru/messages?user_id=${encodeURIComponent(entry.chatId)}`;
                    res = await this.fetchImpl(url, {
                        method: 'POST',
                        headers: {
                            'Authorization': this.maxBotSecret,
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({ text: entry.text }),
                        signal: AbortSignal.timeout(4000),
                    });
                }
                entry.deliveredRemote = res.ok;
            }
            else if (entry.channel === 'vk' && this.vkBotSecret) {
                const url = 'https://api.vk.com/method/messages.send';
                const params = new URLSearchParams({
                    peer_id: entry.chatId,
                    random_id: String(Math.floor(Math.random() * 1e9)),
                    message: entry.text,
                    v: '5.199',
                    access_token: this.vkBotSecret,
                });
                const res = await this.fetchImpl(`${url}?${params.toString()}`, {
                    method: 'POST',
                    signal: AbortSignal.timeout(4000),
                });
                entry.deliveredRemote = res.ok;
            }
        }
        catch { /* в локальном/тестовом режиме остаётся в outboxLog */ }

        return entry;
    }

    /**
     * Зарегистрировать webhook для Telegram (если publicOrigin публичный HTTPS) и/или MAX.
     */
    async syncWebhooks(origin = '') {
        const base = String(origin || this.publicOrigin || '').replace(/\/+$/, '');
        const results = { telegram: null, max: null };
        if (!/^https:\/\/[^/]+/i.test(base) || /localhost|127\.0\.0\.1/i.test(base) || typeof this.fetchImpl !== 'function') {
            return results;
        }
        if (this.telegramBotSecret) {
            try {
                const res = await this.fetchImpl(`https://api.telegram.org/bot${encodeURIComponent(this.telegramBotSecret)}/setWebhook`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url: `${base}/api/bots/telegram/webhook` }),
                });
                results.telegram = await res.json().catch(() => ({ ok: res.ok }));
            }
            catch { /* ignore */ }
        }
        if (this.maxBotSecret) {
            try {
                const res = await this.fetchImpl('https://botapi.max.ru/subscriptions', {
                    method: 'POST',
                    headers: {
                        'Authorization': this.maxBotSecret,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ url: `${base}/api/bots/max/webhook` }),
                });
                results.max = await res.json().catch(() => ({ ok: res.ok }));
            }
            catch { /* ignore */ }
        }
        return results;
    }

    /**
     * Разовый цикл long-polling для Telegram и MAX (удобно, когда сервер без белого HTTPS-домена).
     */
    async pollOnce() {
        if (this._polling || typeof this.fetchImpl !== 'function')
            return;
        this._polling = true;
        try {
            if (this.telegramBotSecret) {
                try {
                    const r = await this.fetchImpl(`https://api.telegram.org/bot${encodeURIComponent(this.telegramBotSecret)}/getUpdates?timeout=0&offset=${this._tgUpdateOffset}`, {
                        signal: AbortSignal.timeout(5000),
                    });
                    if (r.ok) {
                        const j = await r.json().catch(() => ({}));
                        for (const upd of (j.result || [])) {
                            if (upd.update_id >= this._tgUpdateOffset)
                                this._tgUpdateOffset = upd.update_id + 1;
                            if (upd.message || upd.edited_message || upd.callback_query) {
                                await this.handleTelegramWebhook(upd, this.publicOrigin).catch(() => {});
                            }
                        }
                    }
                }
                catch { /* ignore */ }
            }
            if (this.maxBotSecret) {
                try {
                    const qs = this._maxMarker ? `?marker=${encodeURIComponent(this._maxMarker)}&timeout=0` : '?timeout=0';
                    const r = await this.fetchImpl(`https://botapi.max.ru/updates${qs}`, {
                        headers: { 'Authorization': this.maxBotSecret },
                        signal: AbortSignal.timeout(5000),
                    });
                    if (r.ok) {
                        const j = await r.json().catch(() => ({}));
                        if (j.marker != null)
                            this._maxMarker = j.marker;
                        for (const upd of (j.updates || [])) {
                            if (upd.message || upd.update_type === 'message_created') {
                                await this.handleMaxWebhook(upd, this.publicOrigin).catch(() => {});
                            }
                        }
                    }
                }
                catch { /* ignore */ }
            }
        }
        finally {
            this._polling = false;
        }
    }

    startPolling(intervalMs = 4000) {
        if (this._pollTimer || process.env.NODE_TEST_CONTEXT)
            return;
        this._pollTimer = setInterval(() => {
            this.pollOnce().catch(() => {});
        }, Math.max(2000, Number(intervalMs) || 4000));
        this._pollTimer.unref?.();
    }

    stopPolling() {
        if (this._pollTimer) {
            clearInterval(this._pollTimer);
            this._pollTimer = null;
        }
    }
}
