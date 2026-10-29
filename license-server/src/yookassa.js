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
        publicOrigin = process.env.PUBLIC_ORIGIN || 'https://work.odant.org',
        onOrderPaid = null,
        fetchImpl = globalThis.fetch,
    } = {}) {
        this.store = store;
        this.shopId = shopId;
        this.secretKey = secretKey;
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
        const description = order.includeBasePak
            ? `Заказ ${order.orderId}: ПАК WORK (5 вечных мест) + доп. лицензии (${order.addonSeats} мест, ${order.tierName})`
            : `Заказ ${order.orderId}: Годовая лицензия WORK (${order.addonSeats} польз., уровень ${order.tierName}, ${order.years} г.)`;

        return {
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
                licenseId: order.licenseId,
                tier: order.tier,
                addonSeats: String(order.addonSeats),
                years: String(order.years),
                includeBasePak: String(!!order.includeBasePak),
            },
            receipt: {
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
            },
        };
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
     * Обработать входящий HTTP Webhook от ЮKassa (/api/payments/yookassa/webhook).
     */
    async handleWebhook(notification = {}) {
        const event = String(notification.event || '');
        const obj = notification.object || {};
        const paymentId = String(obj.id || '');
        const orderId = String(obj.metadata?.orderId || '');

        let order = orderId ? this.store.getOrder(orderId) : null;
        if (!order && paymentId)
            order = this.store.findOrderByPaymentId(paymentId);

        if (!order) {
            return { ok: false, reason: 'order_not_found', event, orderId, paymentId };
        }

        if (event === 'payment.succeeded' || obj.status === 'succeeded') {
            const result = this.store.completePaidOrder(order.orderId, { paymentId });
            if (!result.alreadyProcessed && typeof this.onOrderPaid === 'function') {
                await Promise.resolve(this.onOrderPaid(result.order, result.license)).catch(() => {});
            }
            return {
                ok: true,
                status: 'paid',
                orderId: result.order.orderId,
                licenseId: result.license.licenseId,
                totalSeats: result.license.totalSeats,
                tier: result.license.support.tierName,
                alreadyProcessed: result.alreadyProcessed,
            };
        }

        if (event === 'payment.canceled' || obj.status === 'canceled') {
            this.store.updateOrder(order.orderId, { status: 'canceled' });
            return { ok: true, status: 'canceled', orderId: order.orderId };
        }

        return { ok: true, status: obj.status || 'ignored', orderId: order.orderId };
    }
}
