/**
 * Встроенный MCP-сервер для Ozon Seller API (https://api-seller.ozon.ru).
 * Ключи берутся из переменных окружения `OZON_CLIENT_ID` и `OZON_API_KEY` (в WORK — через #secret).
 */
import { startMcpStdioServer } from './mcp-stdio.js';

const OZON_BASE = 'https://api-seller.ozon.ru';

function getOzonCreds() {
    const clientId = String(process.env.OZON_CLIENT_ID || '').trim();
    const apiKey = String(process.env.OZON_API_KEY || '').trim();
    if (!clientId || !apiKey) {
        return {
            notConfigured: true,
            hint: 'Укажите Client-Id и Api-Key кабинета Ozon Seller в секретах сервиса /SERVICES/Marketplaces/Ozon: #secret/ozon_client_id и #secret/ozon_api_key.',
        };
    }
    return { clientId, apiKey };
}

async function ozonRequest(relPath, { method = 'POST', body = {} } = {}) {
    const creds = getOzonCreds();
    if (creds.notConfigured)
        return creds;
    const cleanPath = '/' + String(relPath || '').replace(/^\/+/, '');
    if (cleanPath.includes('..') || /^https?:/i.test(String(relPath || '')))
        return { error: 'Недопустимый путь эндпоинта Ozon API' };
    const url = OZON_BASE + cleanPath;
    const res = await fetch(url, {
        method,
        headers: {
            'Client-Id': creds.clientId,
            'Api-Key': creds.apiKey,
            'Content-Type': 'application/json',
            Accept: 'application/json',
        },
        body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
        signal: AbortSignal.timeout(25000),
    });
    const text = await res.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { /* raw */ }
    if (!res.ok)
        return { error: `Ozon API HTTP ${res.status}`, details: parsed || text.slice(0, 1000) };
    return parsed ?? { raw: text.slice(0, 4000) };
}

const tools = [
    {
        name: 'products_list',
        description: 'Получить список товаров продавца на Ozon (/v3/product/list).',
        inputSchema: {
            type: 'object',
            properties: {
                visibility: { type: 'string', description: 'ALL, VISIBLE, INVISIBLE, ARCHIVED (по умолчанию ALL)' },
                last_id: { type: 'string', description: 'Курсор пагинации' },
                limit: { type: 'number', description: 'Количество (1–1000, по умолчанию 50)' },
            },
        },
        handler: (a) => ozonRequest('/v3/product/list', {
            body: {
                filter: { visibility: a.visibility || 'ALL' },
                last_id: a.last_id || '',
                limit: Math.min(1000, Math.max(1, Number(a.limit) || 50)),
            },
        }),
    },
    {
        name: 'products_info',
        description: 'Подробная информация о товарах Ozon по product_id, offer_id или sku (/v3/product/info/list).',
        inputSchema: {
            type: 'object',
            properties: {
                product_id: { type: 'array', items: { type: 'number' }, description: 'Массив product_id' },
                offer_id: { type: 'array', items: { type: 'string' }, description: 'Массив артикулов продавца (offer_id)' },
                sku: { type: 'array', items: { type: 'number' }, description: 'Массив SKU Ozon' },
            },
        },
        handler: (a) => ozonRequest('/v3/product/info/list', {
            body: {
                ...(Array.isArray(a.product_id) && a.product_id.length ? { product_id: a.product_id } : {}),
                ...(Array.isArray(a.offer_id) && a.offer_id.length ? { offer_id: a.offer_id } : {}),
                ...(Array.isArray(a.sku) && a.sku.length ? { sku: a.sku } : {}),
            },
        }),
    },
    {
        name: 'stocks_list',
        description: 'Остатки товаров на складах Ozon FBO и FBS (/v4/product/info/stocks).',
        inputSchema: {
            type: 'object',
            properties: {
                visibility: { type: 'string', description: 'ALL, VISIBLE, INVISIBLE' },
                offer_id: { type: 'array', items: { type: 'string' } },
                cursor: { type: 'string' },
                limit: { type: 'number', description: 'По умолчанию 100' },
            },
        },
        handler: (a) => ozonRequest('/v4/product/info/stocks', {
            body: {
                filter: {
                    visibility: a.visibility || 'ALL',
                    ...(Array.isArray(a.offer_id) && a.offer_id.length ? { offer_id: a.offer_id } : {}),
                },
                cursor: a.cursor || '',
                limit: Math.min(1000, Math.max(1, Number(a.limit) || 100)),
            },
        }),
    },
    {
        name: 'prices_list',
        description: 'Цены, скидки и комиссии товаров на Ozon (/v5/product/info/prices).',
        inputSchema: {
            type: 'object',
            properties: {
                visibility: { type: 'string', description: 'ALL, VISIBLE, INVISIBLE' },
                offer_id: { type: 'array', items: { type: 'string' } },
                cursor: { type: 'string' },
                limit: { type: 'number', description: 'По умолчанию 100' },
            },
        },
        handler: (a) => ozonRequest('/v5/product/info/prices', {
            body: {
                filter: {
                    visibility: a.visibility || 'ALL',
                    ...(Array.isArray(a.offer_id) && a.offer_id.length ? { offer_id: a.offer_id } : {}),
                },
                cursor: a.cursor || '',
                limit: Math.min(1000, Math.max(1, Number(a.limit) || 100)),
            },
        }),
    },
    {
        name: 'orders_fbs_list',
        description: 'Список отправлений (заказов) FBS на Ozon за период (/v3/posting/fbs/list).',
        inputSchema: {
            type: 'object',
            properties: {
                since: { type: 'string', description: 'Начало периода ISO 8601 (по умолчанию последние 7 дней)' },
                to: { type: 'string', description: 'Конец периода ISO 8601' },
                status: { type: 'string', description: 'awaiting_packaging, awaiting_deliver, delivering, delivered, cancelled' },
                limit: { type: 'number', description: 'По умолчанию 50' },
                offset: { type: 'number', description: 'Смещение' },
            },
        },
        handler: (a) => {
            const now = new Date();
            const weekAgo = new Date(now.getTime() - 7 * 86400_000);
            return ozonRequest('/v3/posting/fbs/list', {
                body: {
                    dir: 'DESC',
                    filter: {
                        since: a.since || weekAgo.toISOString(),
                        to: a.to || now.toISOString(),
                        ...(a.status ? { status: a.status } : {}),
                    },
                    limit: Math.min(1000, Math.max(1, Number(a.limit) || 50)),
                    offset: Math.max(0, Number(a.offset) || 0),
                    with: { analytics_data: true, financial_data: true },
                },
            });
        },
    },
    {
        name: 'orders_fbo_list',
        description: 'Список отправлений (заказов) FBO со складов Ozon за период (/v2/posting/fbo/list).',
        inputSchema: {
            type: 'object',
            properties: {
                since: { type: 'string', description: 'Начало периода ISO 8601' },
                to: { type: 'string', description: 'Конец периода ISO 8601' },
                status: { type: 'string' },
                limit: { type: 'number' },
                offset: { type: 'number' },
            },
        },
        handler: (a) => {
            const now = new Date();
            const weekAgo = new Date(now.getTime() - 7 * 86400_000);
            return ozonRequest('/v2/posting/fbo/list', {
                body: {
                    dir: 'DESC',
                    filter: {
                        since: a.since || weekAgo.toISOString(),
                        to: a.to || now.toISOString(),
                        ...(a.status ? { status: a.status } : {}),
                    },
                    limit: Math.min(1000, Math.max(1, Number(a.limit) || 50)),
                    offset: Math.max(0, Number(a.offset) || 0),
                    with: { analytics_data: true, financial_data: true },
                },
            });
        },
    },
    {
        name: 'analytics_data',
        description: 'Аналитика продаж, выручки и показов Ozon за период (/v1/analytics/data).',
        inputSchema: {
            type: 'object',
            properties: {
                date_from: { type: 'string', description: 'YYYY-MM-DD' },
                date_to: { type: 'string', description: 'YYYY-MM-DD' },
                metrics: { type: 'array', items: { type: 'string' }, description: 'Например: ["revenue", "ordered_units"]' },
                dimension: { type: 'array', items: { type: 'string' }, description: 'Например: ["sku", "day"]' },
                limit: { type: 'number' },
            },
            required: ['date_from', 'date_to'],
        },
        handler: (a) => ozonRequest('/v1/analytics/data', {
            body: {
                date_from: a.date_from,
                date_to: a.date_to,
                metrics: Array.isArray(a.metrics) && a.metrics.length ? a.metrics : ['revenue', 'ordered_units'],
                dimension: Array.isArray(a.dimension) && a.dimension.length ? a.dimension : ['day'],
                limit: Math.min(1000, Math.max(1, Number(a.limit) || 100)),
                offset: 0,
            },
        }),
    },
    {
        name: 'finance_transactions',
        description: 'Финансовые транзакции и начисления Ozon за период (/v3/finance/transaction/list).',
        inputSchema: {
            type: 'object',
            properties: {
                from: { type: 'string', description: 'ISO 8601' },
                to: { type: 'string', description: 'ISO 8601' },
                page: { type: 'number' },
                page_size: { type: 'number' },
            },
        },
        handler: (a) => {
            const now = new Date();
            const weekAgo = new Date(now.getTime() - 7 * 86400_000);
            return ozonRequest('/v3/finance/transaction/list', {
                body: {
                    filter: {
                        date: { from: a.from || weekAgo.toISOString(), to: a.to || now.toISOString() },
                        transaction_type: 'all',
                    },
                    page: Math.max(1, Number(a.page) || 1),
                    page_size: Math.min(1000, Math.max(1, Number(a.page_size) || 100)),
                },
            });
        },
    },
    {
        name: 'prices_update',
        description: '[ЗАПИСЬ] Обновить цены товаров на Ozon (/v1/product/import/prices).',
        inputSchema: {
            type: 'object',
            properties: {
                prices: { type: 'array', items: { type: 'object' }, description: 'Массив { offer_id/product_id, price, old_price?, min_price?, currency_code? }' },
            },
            required: ['prices'],
        },
        handler: (a) => ozonRequest('/v1/product/import/prices', { body: { prices: a.prices } }),
    },
    {
        name: 'stocks_update',
        description: '[ЗАПИСЬ] Обновить остатки товаров на складах FBS Ozon (/v2/products/stocks).',
        inputSchema: {
            type: 'object',
            properties: {
                stocks: { type: 'array', items: { type: 'object' }, description: 'Массив { offer_id/product_id, stock, warehouse_id }' },
            },
            required: ['stocks'],
        },
        handler: (a) => ozonRequest('/v2/products/stocks', { body: { stocks: a.stocks } }),
    },
    {
        name: 'api_call',
        description: 'Универсальный запрос к любому методу Ozon Seller API (https://api-seller.ozon.ru).',
        inputSchema: {
            type: 'object',
            properties: {
                endpoint: { type: 'string', description: 'Путь эндпоинта, например /v2/warehouse/list' },
                method: { type: 'string', description: 'POST или GET (по умолчанию POST)' },
                body: { type: 'object', description: 'JSON-тело запроса' },
            },
            required: ['endpoint'],
        },
        handler: (a) => ozonRequest(a.endpoint, { method: String(a.method || 'POST').toUpperCase(), body: a.body }),
    },
];

startMcpStdioServer({ name: 'ozon-seller-mcp', version: '1.0.0', tools });
