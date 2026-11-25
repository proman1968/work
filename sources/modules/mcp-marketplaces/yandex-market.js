/**
 * Встроенный MCP-сервер для Yandex Market Partner API (https://api.partner.market.yandex.ru).
 * Ключи берутся из `YANDEX_MARKET_API_KEY` и (опционально) `YANDEX_MARKET_CAMPAIGN_ID` (в WORK — через #secret).
 */
import { startMcpStdioServer } from './mcp-stdio.js';

const YM_BASE = 'https://api.partner.market.yandex.ru';

function getYmCreds() {
    const apiKey = String(process.env.YANDEX_MARKET_API_KEY || '').trim();
    const campaignId = String(process.env.YANDEX_MARKET_CAMPAIGN_ID || '').trim();
    if (!apiKey) {
        return {
            notConfigured: true,
            hint: 'Укажите Api-Key партнёра Яндекс Маркета в секрете сервиса /SERVICES/Marketplaces/YandexMarket: #secret/yandex_market_api_key (и при желании #secret/yandex_market_campaign_id).',
        };
    }
    return { apiKey, campaignId };
}

async function ymRequest(relPath, { method = 'GET', query = null, body = undefined } = {}) {
    const creds = getYmCreds();
    if (creds.notConfigured)
        return creds;
    const cleanPath = '/' + String(relPath || '').replace(/^\/+/, '');
    if (cleanPath.includes('..') || /^https?:/i.test(String(relPath || '')))
        return { error: 'Недопустимый путь эндпоинта Yandex Market API' };
    const urlObj = new URL(YM_BASE + cleanPath);
    if (query && typeof query === 'object') {
        for (const [k, v] of Object.entries(query)) {
            if (v != null && v !== '')
                urlObj.searchParams.set(k, String(v));
        }
    }
    const res = await fetch(urlObj.toString(), {
        method,
        headers: {
            'Api-Key': creds.apiKey,
            Accept: 'application/json',
            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(25000),
    });
    const text = await res.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { /* raw */ }
    if (!res.ok)
        return { error: `Yandex Market API HTTP ${res.status}`, details: parsed || text.slice(0, 1000) };
    return parsed ?? { raw: text.slice(0, 4000) };
}

function resolveCampaignId(argId) {
    return String(argId || process.env.YANDEX_MARKET_CAMPAIGN_ID || '').trim();
}

const tools = [
    {
        name: 'campaigns_list',
        description: 'Список магазинов (кампаний) и их businessId в кабинете Яндекс Маркета (/campaigns).',
        inputSchema: {
            type: 'object',
            properties: {
                page: { type: 'number' },
                pageSize: { type: 'number' },
            },
        },
        handler: (a) => ymRequest('/campaigns', { query: { page: a.page, pageSize: a.pageSize } }),
    },
    {
        name: 'offers_list',
        description: 'Список товаров и карточек кабинета Яндекс Маркета (/businesses/{businessId}/offer-mappings).',
        inputSchema: {
            type: 'object',
            properties: {
                businessId: { type: 'number', description: 'ID кабинета (businessId — можно узнать через campaigns_list)' },
                offerIds: { type: 'array', items: { type: 'string' } },
                page_token: { type: 'string' },
                limit: { type: 'number' },
            },
            required: ['businessId'],
        },
        handler: (a) => ymRequest(`/businesses/${encodeURIComponent(a.businessId)}/offer-mappings`, {
            method: 'POST',
            query: {
                ...(a.page_token ? { page_token: a.page_token } : {}),
                limit: Math.min(200, Math.max(1, Number(a.limit) || 50)),
            },
            body: Array.isArray(a.offerIds) && a.offerIds.length ? { offerIds: a.offerIds } : {},
        }),
    },
    {
        name: 'stocks_list',
        description: 'Остатки товаров магазина на Яндекс Маркете (/campaigns/{campaignId}/offers/stocks).',
        inputSchema: {
            type: 'object',
            properties: {
                campaignId: { type: 'string', description: 'ID кампании (магазина)' },
                offerIds: { type: 'array', items: { type: 'string' } },
                limit: { type: 'number' },
                page_token: { type: 'string' },
            },
        },
        handler: (a) => {
            const cid = resolveCampaignId(a.campaignId);
            if (!cid) return { error: 'Укажите campaignId (или задайте #secret/yandex_market_campaign_id)' };
            return ymRequest(`/campaigns/${encodeURIComponent(cid)}/offers/stocks`, {
                method: 'POST',
                query: {
                    ...(a.page_token ? { page_token: a.page_token } : {}),
                    limit: Math.min(500, Math.max(1, Number(a.limit) || 50)),
                },
                body: Array.isArray(a.offerIds) && a.offerIds.length ? { offerIds: a.offerIds } : {},
            });
        },
    },
    {
        name: 'orders_list',
        description: 'Список заказов магазина на Яндекс Маркете (/campaigns/{campaignId}/orders).',
        inputSchema: {
            type: 'object',
            properties: {
                campaignId: { type: 'string', description: 'ID кампании (магазина)' },
                status: { type: 'string', description: 'PROCESSING, DELIVERY, PICKUP, DELIVERED, CANCELLED' },
                fromDate: { type: 'string', description: 'DD-MM-YYYY или YYYY-MM-DD' },
                toDate: { type: 'string' },
                page: { type: 'number' },
                pageSize: { type: 'number' },
            },
        },
        handler: (a) => {
            const cid = resolveCampaignId(a.campaignId);
            if (!cid) return { error: 'Укажите campaignId (или задайте #secret/yandex_market_campaign_id)' };
            return ymRequest(`/campaigns/${encodeURIComponent(cid)}/orders`, {
                query: {
                    ...(a.status ? { status: a.status } : {}),
                    ...(a.fromDate ? { fromDate: a.fromDate } : {}),
                    ...(a.toDate ? { toDate: a.toDate } : {}),
                    page: a.page || 1,
                    pageSize: Math.min(50, Math.max(1, Number(a.pageSize) || 20)),
                },
            });
        },
    },
    {
        name: 'stats_orders',
        description: 'Отчёт по заказам и продажам Яндекс Маркета (/campaigns/{campaignId}/stats/orders).',
        inputSchema: {
            type: 'object',
            properties: {
                campaignId: { type: 'string' },
                dateFrom: { type: 'string', description: 'YYYY-MM-DD' },
                dateTo: { type: 'string', description: 'YYYY-MM-DD' },
                limit: { type: 'number' },
            },
            required: ['dateFrom', 'dateTo'],
        },
        handler: (a) => {
            const cid = resolveCampaignId(a.campaignId);
            if (!cid) return { error: 'Укажите campaignId (или задайте #secret/yandex_market_campaign_id)' };
            return ymRequest(`/campaigns/${encodeURIComponent(cid)}/stats/orders`, {
                method: 'POST',
                query: { limit: Math.min(200, Math.max(1, Number(a.limit) || 50)) },
                body: { dateFrom: a.dateFrom, dateTo: a.dateTo },
            });
        },
    },
    {
        name: 'prices_update',
        description: '[ЗАПИСЬ] Обновить цены товаров в кабинете Яндекс Маркета (/businesses/{businessId}/offer-prices/updates).',
        inputSchema: {
            type: 'object',
            properties: {
                businessId: { type: 'number', description: 'ID кабинета' },
                offers: { type: 'array', items: { type: 'object' }, description: 'Массив { offerId, price: { value, currencyId: "RUR", discountBase? } }' },
            },
            required: ['businessId', 'offers'],
        },
        handler: (a) => ymRequest(`/businesses/${encodeURIComponent(a.businessId)}/offer-prices/updates`, {
            method: 'POST',
            body: { offers: a.offers },
        }),
    },
    {
        name: 'stocks_update',
        description: '[ЗАПИСЬ] Обновить остатки товаров магазина на Яндекс Маркете (/campaigns/{campaignId}/offers/stocks).',
        inputSchema: {
            type: 'object',
            properties: {
                campaignId: { type: 'string' },
                skus: { type: 'array', items: { type: 'object' }, description: 'Массив { sku, items: [{ count, updatedAt? }] }' },
            },
            required: ['skus'],
        },
        handler: (a) => {
            const cid = resolveCampaignId(a.campaignId);
            if (!cid) return { error: 'Укажите campaignId (или задайте #secret/yandex_market_campaign_id)' };
            return ymRequest(`/campaigns/${encodeURIComponent(cid)}/offers/stocks`, {
                method: 'PUT',
                body: { skus: a.skus },
            });
        },
    },
    {
        name: 'api_call',
        description: 'Универсальный запрос к Yandex Market Partner API (https://api.partner.market.yandex.ru).',
        inputSchema: {
            type: 'object',
            properties: {
                endpoint: { type: 'string', description: 'Путь эндпоинта, например /campaigns' },
                method: { type: 'string', description: 'GET, POST, PUT или DELETE' },
                query: { type: 'object' },
                body: { type: 'object' },
            },
            required: ['endpoint'],
        },
        handler: (a) => ymRequest(a.endpoint, {
            method: String(a.method || 'GET').toUpperCase(),
            query: a.query,
            body: a.body,
        }),
    },
];

startMcpStdioServer({ name: 'yandex-market-mcp', version: '1.0.0', tools });
