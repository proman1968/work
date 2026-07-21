import * as crypto from 'node:crypto';

const API = 'https://api.yookassa.ru/v3';

function authHeader(config) {
    const token = Buffer.from(`${config.shopId}:${config.secretKey}`).toString('base64');
    return `Basic ${token}`;
}

async function apiRequest(config, path, { method = 'GET', body, idempotenceKey } = {}) {
    if (!config?.shopId || !config?.secretKey)
        throw new Error('ЮKassa не настроена (#system/yookassa.json)');

    const headers = {
        Authorization: authHeader(config),
        'Content-Type': 'application/json',
    };
    if (idempotenceKey)
        headers['Idempotence-Key'] = idempotenceKey;

    const res = await fetch(API + path, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); }
    catch { data = { raw: text }; }
    if (!res.ok)
        throw new Error(data?.description || data?.raw || `YooKassa HTTP ${res.status}`);
    return data;
}

export async function createPayment(config, { amount, txId, metadata = {}, description = 'Пополнение баланса WORK' }) {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0)
        throw new Error('Некорректная сумма пополнения');

    const body = {
        amount: { value: value.toFixed(2), currency: 'RUB' },
        capture: true,
        confirmation: {
            type: 'redirect',
            return_url: config?.returnUrl || '/SYS/Billing/~/handlers//dashboard/?payment=done',
        },
        description,
        metadata: { txId, ...metadata },
    };
    return apiRequest(config, '/payments', {
        method: 'POST',
        body,
        idempotenceKey: txId || crypto.randomUUID(),
    });
}

export async function getPayment(config, paymentId) {
    return apiRequest(config, `/payments/${paymentId}`);
}

export function verifyWebhook(body, headers = {}, config = {}) {
    if (!body?.event || !body?.object?.id)
        return { ok: false, reason: 'invalid webhook payload' };
    if (config.webhookSecret) {
        const sig = headers['x-yookassa-signature'] || headers['X-YooKassa-Signature'];
        if (!sig)
            return { ok: false, reason: 'missing signature' };
        const h = crypto.createHmac('sha256', config.webhookSecret);
        h.update(typeof body === 'string' ? body : JSON.stringify(body));
        const digest = h.digest('hex');
        if (digest !== sig)
            return { ok: false, reason: 'bad signature' };
    }
    return { ok: true, event: body.event, payment: body.object };
}
