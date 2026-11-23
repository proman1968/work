/**
 * Интеграция платёжного шлюза ЮKassa (API v3: https://api.yookassa.ru/v3/payments)
 * для продажи ПАК WORK и дополнительных годовых пользовательских лицензий (Start / Business / Enterprise).
 *
 * Поддерживает:
 *  - Боевой режим ЮKassa (Basic Auth shopId:secretKey, Idempotence-Key, 54-ФЗ чек receipt, metadata);
 *  - Встроенный песочный режим (когда боевые ключи не заданы в окружении) со страницей тестовой оплаты
 *    /pay/sandbox/:orderId, эмулирующей полный цикл ЮKassa вплоть до webhook payment.succeeded;
 *  - Обработку входящих webhook-уведомлений ЮKassa (payment.succeeded, payment.canceled, refund.succeeded).
 */
import crypto from 'node:crypto';

const YOOKASSA_API_URL = 'https://api.yookassa.ru/v3/payments';

export class YooKassaService {
    constructor({
        store,
        shopId = process.env.YOOKASSA_SHOP_ID || '',
        secretKey = process.env.YOOKASSA_SECRET_KEY || '',
        sendReceipt = true,
        verifyWebhookViaApi = true,
        publicOrigin = process.env.PUBLIC_ORIGIN || 'https://work.odant.org',
        onOrderPaid = null,
        fetchImpl = globalThis.fetch,
    } = {}) {
        this.store = store;
        this.shopId = shopId;
        this.secretKey = secretKey;
        this.sendReceipt = sendReceipt !== undefined ? Boolean(sendReceipt) : true;
        this.verifyWebhookViaApi = verifyWebhookViaApi !== false;
        this.publicOrigin = String(publicOrigin).replace(/\/+$/, '');
        this.onOrderPaid = onOrderPaid;
        this.fetchImpl = fetchImpl;
    }

    get isLiveMode() {
        return Boolean(this.shopId && this.secretKey);
    }

    /**
     * Сформировать тело запроса к ЮKassa v3 (/v3/payments) с чеком по 54-ФЗ.
     */
    buildYooKassaPaymentPayload(order) {
        const valueStr = Number(order.amountRub || 0).toFixed(2);
        const description = order.kind === 'franchise_reservation'
            ? `Заказ ${order.orderId}: Невозвратный залог за франшизу ODANT-WORK (${order.regionName})`
            : order.kind === 'franchise_installment'
                ? `Заказ ${order.orderId}: Оплата паушального взноса франшизы ODANT-WORK (${order.regionName})`
                : order.includeBasePak
                    ? `Заказ ${order.orderId}: ПАК ODANT-WORK (10 вечных лицензий + 1 год Enterprise) + доп. места (${order.addonSeats} мест, ${order.tierName})`
                    : order.includeBaseLicenseOnly
                        ? `Заказ ${order.orderId}: Базовая вечная лицензия ODANT-WORK (10 мест) + доп. (${order.addonSeats} мест, ${order.tierName})`
                        : `Заказ ${order.orderId}: Годовая лицензия WORK (${order.addonSeats} польз., уровень ${order.tierName}, ${order.years} г.)`;

        const payload = {
            amount: {
                value: valueStr,
                currency: 'RUB',
            },
            capture: true,
            confirmation: {
                type: 'redirect',
                return_url: order.returnUrl || `${this.publicOrigin}/?order=${encodeURIComponent(order.orderId)}`,
            },
            description: description.slice(0, 128),
            metadata: {
                orderId: order.orderId,
                kind: order.kind || 'license',
                licenseId: order.licenseId || '',
                reservationId: order.reservationId || '',
                tier: order.tier || '',
                addonSeats: String(order.addonSeats || 0),
                years: String(order.years || 1),
                includeBasePak: String(!!order.includeBasePak),
                includeBaseLicenseOnly: String(!!order.includeBaseLicenseOnly),
            },
        };
        if (this.sendReceipt !== false) {
            payload.receipt = {
                customer: {
                    email: order.customer?.email || 'billing@odant.org',
                    ...(order.customer?.inn ? { inn: String(order.customer.inn) } : {}),
                    ...(order.customer?.name ? { full_name: String(order.customer.name) } : {}),
                },
                items: (order.items || []).map(item => ({
                    description: String(item.title || 'Лицензия WORK').slice(0, 128),
                    quantity: String(item.quantity || 1),
                    amount: {
                        value: Number(item.unitPriceRub || order.amountRub).toFixed(2),
                        currency: 'RUB',
                    },
                    vat_code: 1,
                    payment_mode: 'full_payment',
                    payment_subject: 'intellectual_activity',
                })),
            };
        }
        return payload;
    }

    /**
     * Создать платёж в ЮKassa (или в локальной песочнице, если не заданы боевые ключи).
     */
    async createPaymentForOrder(order, { originOverride = '' } = {}) {
        const baseOrigin = String(originOverride || this.publicOrigin).replace(/\/+$/, '');
        const body = this.buildYooKassaPaymentPayload(order);

        if (this.isLiveMode && typeof this.fetchImpl === 'function') {
            const idempotenceKey = crypto.randomUUID();
            const basicCreds = Buffer.from(`${this.shopId}:${this.secretKey}`, 'utf8').toString('base64');
            const res = await this.fetchImpl(YOOKASSA_API_URL, {
                method: 'POST',
                headers: {
                    'Authorization': `Basic ${basicCreds}`,
                    'Idempotence-Key': idempotenceKey,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(body),
            });
            if (!res.ok) {
                const errText = await res.text().catch(() => '');
                throw new Error(`ЮKassa API вернула HTTP ${res.status}: ${errText.slice(0, 240)}`);
            }
            const payment = await res.json();
            const paymentId = payment.id;
            const confirmationUrl = payment.confirmation?.confirmation_url || '';
            this.store.updateOrder(order.orderId, {
                paymentId,
                confirmationUrl,
                yookassaMode: 'live',
            });
            return {
                orderId: order.orderId,
                licenseId: order.licenseId,
                amountRub: order.amountRub,
                paymentId,
                confirmationUrl,
                mode: 'live',
            };
        }

        // Песочница ЮKassa (для локального запуска и демонстрации без боевых ключей)
        const paymentId = 'yk_sandbox_' + crypto.randomBytes(8).toString('hex');
        const confirmationUrl = `${baseOrigin}/pay/sandbox/${encodeURIComponent(order.orderId)}`;
        this.store.updateOrder(order.orderId, {
            paymentId,
            confirmationUrl,
            yookassaMode: 'sandbox',
        });
        return {
            orderId: order.orderId,
            licenseId: order.licenseId,
            amountRub: order.amountRub,
            paymentId,
            confirmationUrl,
            mode: 'sandbox',
        };
    }

    /**
     * Запросить актуальный статус платежа напрямую в API ЮKassa (GET /v3/payments/{id}).
     */
    async fetchPaymentStatus(paymentId) {
        const pid = String(paymentId || '').trim();
        if (!pid || !this.isLiveMode || typeof this.fetchImpl !== 'function')
            return null;
        const basicCreds = Buffer.from(`${this.shopId}:${this.secretKey}`, 'utf8').toString('base64');
        const res = await this.fetchImpl(`${YOOKASSA_API_URL}/${encodeURIComponent(pid)}`, {
            method: 'GET',
            headers: {
                'Authorization': `Basic ${basicCreds}`,
                'Content-Type': 'application/json',
            },
        });
        if (!res.ok) {
            const errText = await res.text().catch(() => '');
            throw new Error(`ЮKassa API GET /payments/${pid} вернула HTTP ${res.status}: ${errText.slice(0, 240)}`);
        }
        return res.json();
    }

    async _finalizePaidOrder(order, paymentId = '') {
        const result = this.store.completePaidOrder(order.orderId, { paymentId });
        if (!result.alreadyProcessed && typeof this.onOrderPaid === 'function') {
            await Promise.resolve(this.onOrderPaid(result)).catch(() => {});
        }
        if (result.reservation) {
            return {
                ok: true,
                status: 'paid',
                kind: result.order.kind || 'franchise_reservation',
                orderId: result.order.orderId,
                reservationId: result.reservation.reservationId,
                partnerId: result.partner?.partnerId || result.reservation.convertedToPartnerId || '',
                regionCode: result.reservation.regionCode,
                regionName: result.reservation.regionName,
                alreadyProcessed: result.alreadyProcessed,
            };
        }
        return {
            ok: true,
            status: 'paid',
            kind: result.order.kind || 'license',
            orderId: result.order.orderId,
            licenseId: result.license?.licenseId || result.order.licenseId,
            baseActivated: Boolean(result.license?.baseActivated),
            totalSeats: result.license?.totalSeats ?? 0,
            tier: result.license?.support?.tierName || result.order.tierName || '',
            alreadyProcessed: result.alreadyProcessed,
        };
    }

    /**
     * Проверить и синхронизировать оплату заказа (используется при возврате пользователя с ЮKassa по return_url).
     */
    async syncOrderPayment(orderId) {
        const order = this.store.getOrder(orderId);
        if (!order)
            return { ok: false, reason: 'order_not_found', orderId };

        if (order.status === 'paid') {
            return this._finalizePaidOrder(order, order.paymentId || '');
        }
        if (order.status === 'canceled') {
            return { ok: true, status: 'canceled', orderId: order.orderId };
        }

        if (this.isLiveMode && order.paymentId && !String(order.paymentId).startsWith('yk_sandbox_')) {
            const remote = await this.fetchPaymentStatus(order.paymentId);
            if (remote?.status === 'succeeded') {
                return this._finalizePaidOrder(order, remote.id || order.paymentId);
            }
            if (remote?.status === 'canceled') {
                this.store.cancelOrder(order.orderId);
                return { ok: true, status: 'canceled', orderId: order.orderId };
            }
            return {
                ok: true,
                status: remote?.status || order.status || 'pending',
                orderId: order.orderId,
                paymentId: order.paymentId,
            };
        }

        return {
            ok: true,
            status: order.status || 'pending',
            orderId: order.orderId,
            paymentId: order.paymentId || '',
        };
    }

    /**
     * Обработать входящий HTTP Webhook от ЮKassa (/api/payments/yookassa/webhook).
     */
    async handleWebhook(notification = {}) {
        const event = String(notification.event || '');
        const obj = notification.object || {};
        let paymentId = String(obj.id || '');
        let effectiveStatus = String(obj.status || '');
        const orderId = String(obj.metadata?.orderId || '');

        let order = orderId ? this.store.getOrder(orderId) : null;
        if (!order && paymentId)
            order = this.store.findOrderByPaymentId(paymentId);

        if (!order) {
            return { ok: false, reason: 'order_not_found', event, orderId, paymentId };
        }

        // В боевом режиме дополнительно перепроверяем статус платежа напрямую через API ЮKassa
        if (this.isLiveMode && this.verifyWebhookViaApi && paymentId && !paymentId.startsWith('yk_sandbox_') && typeof this.fetchImpl === 'function') {
            const verified = await this.fetchPaymentStatus(paymentId);
            if (!verified) {
                return { ok: false, reason: 'payment_verification_failed', orderId: order.orderId, paymentId };
            }
            effectiveStatus = String(verified.status || '');
            paymentId = String(verified.id || paymentId);
        }

        if (event === 'payment.succeeded' || effectiveStatus === 'succeeded') {
            return this._finalizePaidOrder(order, paymentId);
        }

        if (event === 'payment.canceled' || effectiveStatus === 'canceled') {
            this.store.cancelOrder(order.orderId);
            return { ok: true, status: 'canceled', orderId: order.orderId };
        }

        return { ok: true, status: effectiveStatus || 'ignored', orderId: order.orderId };
    }
}
