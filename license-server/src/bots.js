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
    }

    /**
     * Универсальная обработка входящего сообщения от пользователя из любого мессенджера (max | telegram | vk).
     */
    async handleIncomingMessage({ channel, chatId, userName = 'Клиент', text = '', originOverride = '' }) {
        const ch = String(channel || 'telegram').toLowerCase();
        const cid = String(chatId || 'demo-chat');
        const cleanText = String(text || '').trim();

        if (!cleanText || /^\/(start|help|помощь)$/i.test(cleanText)) {
            const bound = this.store.getBoundLicenseForChat(ch, cid);
            const greeting = [
                `Здравствуйте, ${userName}! Это служба поддержки и лицензирования ПАК WORK (${ch.toUpperCase()}).`,
                bound
                    ? `Ваш чат привязан к лицензии: ${bound.licenseId} (${bound.customer?.name || 'ПАК WORK'}, уровень ${bound.support.tierName}, мест: ${bound.totalSeats}).`
                    : 'Для начала работы привяжите ваш ПАК WORK командой:\n/bind <НОМЕР_ЛИЦЕНЗИИ_ИЛИ_КОД>',
                '',
                'Доступные команды:',
                '• /bind <КОД> — привязать ПАК WORK к этому чату',
                '• /status — проверить рабочие места (10 вечных + годовые), SLA и остаток обращений',
                '• /buy <start|business|enterprise> <кол-во_мест> — докупить годовые лицензии через ЮKassa',
                '• Любое другое сообщение — создать обращение в инженерную поддержку по вашему SLA.',
            ].join('\n');
            await this.sendExternalMessage(ch, cid, greeting);
            return { action: 'help', reply: greeting };
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
                });
                entry.deliveredRemote = res.ok;
            }
            else if (entry.channel === 'max' && this.maxBotSecret) {
                const url = `https://botapi.max.ru/messages?chat_id=${encodeURIComponent(entry.chatId)}`;
                const res = await this.fetchImpl(url, {
                    method: 'POST',
                    headers: {
                        'Authorization': this.maxBotSecret,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ text: entry.text }),
                });
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
                const res = await this.fetchImpl(`${url}?${params.toString()}`, { method: 'POST' });
                entry.deliveredRemote = res.ok;
            }
        }
        catch { /* в локальном/тестовом режиме остаётся в outboxLog */ }

        return entry;
    }
}
