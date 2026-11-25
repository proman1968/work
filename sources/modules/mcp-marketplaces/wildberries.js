/**
 * Встроенный MCP-сервер для Wildberries Seller API.
 * Ключ берётся из переменной окружения `WB_API_TOKEN` (в WORK — через #secret).
 */
import { startMcpStdioServer } from './mcp-stdio.js';

const WB_ALLOWED_HOSTS = new Set([
    'content-api.wildberries.ru',
    'discounts-prices-api.wildberries.ru',
    'marketplace-api.wildberries.ru',
    'statistics-api.wildberries.ru',
    'seller-analytics-api.wildberries.ru',
    'feedbacks-api.wildberries.ru',
    'advert-api.wildberries.ru',
    'supplies-api.wildberries.ru',
    'common-api.wildberries.ru',
]);

function getWbToken() {
    const token = String(process.env.WB_API_TOKEN || '').trim();
    if (!token) {
        return {
            notConfigured: true,
            hint: 'Укажите API-токен Wildberries Seller в секрете сервиса /SERVICES/Marketplaces/Wildberries: #secret/wb_api_token.',
        };
    }
    return { token };
}

async function wbRequest(fullUrl, { method = 'GET', query = null, body = undefined } = {}) {
    const creds = getWbToken();
    if (creds.notConfigured)
        return creds;
    let urlObj;
    try {
        urlObj = new URL(fullUrl);
    }
    catch {
        return { error: 'Некорректный URL Wildberries API' };
    }
    if (urlObj.protocol !== 'https:' || !WB_ALLOWED_HOSTS.has(urlObj.hostname))
        return { error: `Домен ${urlObj.hostname} не входит в разрешённые хосты Wildberries API` };
    if (query && typeof query === 'object') {
        for (const [k, v] of Object.entries(query)) {
            if (v != null && v !== '')
                urlObj.searchParams.set(k, String(v));
        }
    }
    const res = await fetch(urlObj.toString(), {
        method,
        headers: {
            Authorization: creds.token,
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
        return { error: `Wildberries API HTTP ${res.status}`, details: parsed || text.slice(0, 1000) };
    return parsed ?? { raw: text.slice(0, 4000) };
}

const tools = [
    {
        name: 'cards_list',
        description: 'Получить список карточек товаров Wildberries (content-api).',
        inputSchema: {
            type: 'object',
            properties: {
                textSearch: { type: 'string', description: 'Поиск по артикулу или названию' },
                limit: { type: 'number', description: 'Количество карточек (по умолчанию 50)' },
                updatedAt: { type: 'string' },
                nmID: { type: 'number' },
            },
        },
        handler: (a) => wbRequest('https://content-api.wildberries.ru/content/v2/get/cards/list', {
            method: 'POST',
            body: {
                settings: {
                    cursor: {
                        limit: Math.min(100, Math.max(1, Number(a.limit) || 50)),
                        ...(a.updatedAt ? { updatedAt: a.updatedAt } : {}),
                        ...(a.nmID ? { nmID: Number(a.nmID) } : {}),
                    },
                    filter: {
                        withPhoto: -1,
                        ...(a.textSearch ? { textSearch: a.textSearch } : {}),
                    },
                },
            },
        }),
    },
    {
        name: 'prices_list',
        description: 'Получить текущие цены и скидки товаров на Wildberries (discounts-prices-api).',
        inputSchema: {
            type: 'object',
            properties: {
                limit: { type: 'number', description: 'По умолчанию 50 (до 1000)' },
                offset: { type: 'number', description: 'Смещение' },
                filterNmID: { type: 'number', description: 'Фильтр по артикулу WB (nmID)' },
            },
        },
        handler: (a) => wbRequest('https://discounts-prices-api.wildberries.ru/api/v2/list/goods/filter', {
            query: {
                limit: Math.min(1000, Math.max(1, Number(a.limit) || 50)),
                offset: Math.max(0, Number(a.offset) || 0),
                ...(a.filterNmID ? { filterNmID: a.filterNmID } : {}),
            },
        }),
    },
    {
        name: 'warehouses_list',
        description: 'Список складов продавца Wildberries (FBS).',
        inputSchema: { type: 'object', properties: {} },
        handler: () => wbRequest('https://marketplace-api.wildberries.ru/api/v3/warehouses'),
    },
    {
        name: 'stocks_get',
        description: 'Остатки товаров на складе продавца WB по списку баркодов skus.',
        inputSchema: {
            type: 'object',
            properties: {
                warehouseId: { type: 'number', description: 'ID склада продавца' },
                skus: { type: 'array', items: { type: 'string' }, description: 'Массив баркодов (skus)' },
            },
            required: ['warehouseId', 'skus'],
        },
        handler: (a) => wbRequest(`https://marketplace-api.wildberries.ru/api/v3/stocks/${encodeURIComponent(a.warehouseId)}`, {
            method: 'POST',
            body: { skus: a.skus },
        }),
    },
    {
        name: 'orders_fbs_list',
        description: 'Список сборочных заданий FBS на Wildberries.',
        inputSchema: {
            type: 'object',
            properties: {
                limit: { type: 'number', description: 'По умолчанию 100 (до 1000)' },
                next: { type: 'number', description: 'Курсор next (по умолчанию 0)' },
                dateFrom: { type: 'number', description: 'Unix timestamp (сек)' },
                dateTo: { type: 'number', description: 'Unix timestamp (сек)' },
            },
        },
        handler: (a) => wbRequest('https://marketplace-api.wildberries.ru/api/v3/orders', {
            query: {
                limit: Math.min(1000, Math.max(1, Number(a.limit) || 100)),
                next: Number(a.next) || 0,
                ...(a.dateFrom ? { dateFrom: a.dateFrom } : {}),
                ...(a.dateTo ? { dateTo: a.dateTo } : {}),
            },
        }),
    },
    {
        name: 'stat_orders',
        description: 'Статистика заказов Wildberries (FBO/FBS) с указанной даты (statistics-api).',
        inputSchema: {
            type: 'object',
            properties: {
                dateFrom: { type: 'string', description: 'Дата/время в формате RFC3339 или YYYY-MM-DD (по умолчанию 7 дней назад)' },
                flag: { type: 'number', description: '0 — с даты, 1 — за конкретный день' },
            },
        },
        handler: (a) => {
            const defDate = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
            return wbRequest('https://statistics-api.wildberries.ru/api/v1/supplier/orders', {
                query: { dateFrom: a.dateFrom || defDate, flag: a.flag ?? 0 },
            });
        },
    },
    {
        name: 'stat_sales',
        description: 'Статистика продаж и возвратов Wildberries с указанной даты (statistics-api).',
        inputSchema: {
            type: 'object',
            properties: {
                dateFrom: { type: 'string', description: 'YYYY-MM-DD (по умолчанию 7 дней назад)' },
                flag: { type: 'number' },
            },
        },
        handler: (a) => {
            const defDate = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
            return wbRequest('https://statistics-api.wildberries.ru/api/v1/supplier/sales', {
                query: { dateFrom: a.dateFrom || defDate, flag: a.flag ?? 0 },
            });
        },
    },
    {
        name: 'prices_update',
        description: '[ЗАПИСЬ] Загрузить новые цены и скидки на Wildberries (/api/v2/upload/task).',
        inputSchema: {
            type: 'object',
            properties: {
                data: { type: 'array', items: { type: 'object' }, description: 'Массив { nmID, price, discount }' },
            },
            required: ['data'],
        },
        handler: (a) => wbRequest('https://discounts-prices-api.wildberries.ru/api/v2/upload/task', {
            method: 'POST',
            body: { data: a.data },
        }),
    },
    {
        name: 'stocks_update',
        description: '[ЗАПИСЬ] Обновить остатки на складе продавца WB FBS.',
        inputSchema: {
            type: 'object',
            properties: {
                warehouseId: { type: 'number', description: 'ID склада продавца' },
                stocks: { type: 'array', items: { type: 'object' }, description: 'Массив { sku, amount }' },
            },
            required: ['warehouseId', 'stocks'],
        },
        handler: (a) => wbRequest(`https://marketplace-api.wildberries.ru/api/v3/stocks/${encodeURIComponent(a.warehouseId)}`, {
            method: 'PUT',
            body: { stocks: a.stocks },
        }),
    },
    {
        name: 'api_call',
        description: 'Универсальный запрос к официальным доменам Wildberries Seller API (*.wildberries.ru).',
        inputSchema: {
            type: 'object',
            properties: {
                url: { type: 'string', description: 'Полный HTTPS URL эндпоинта WB (например https://marketplace-api.wildberries.ru/api/v3/orders/new)' },
                method: { type: 'string', description: 'GET, POST, PUT или PATCH' },
                query: { type: 'object' },
                body: { type: 'object' },
            },
            required: ['url'],
        },
        handler: (a) => wbRequest(a.url, { method: String(a.method || 'GET').toUpperCase(), query: a.query, body: a.body }),
    },
];

startMcpStdioServer({ name: 'wildberries-seller-mcp', version: '1.0.0', tools });
