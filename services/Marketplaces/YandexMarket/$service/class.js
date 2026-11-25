/**
 * Yandex Market Partner MCP (/SERVICES/Marketplaces/YandexMarket).
 * Секреты сохраняются в #secret/yandex_market_api_key и #secret/yandex_market_campaign_id.
 */
export default {
    icon: 'carbon:shopping-catalog',
    label: 'Яндекс Маркет MCP',
    description: 'Магазины, товары/офферы, остатки, цены, заказы и отчёты через Yandex Market Partner API',
    capabilities: ['marketplace', 'yandex-market', 'ecommerce'],
    enabled: true,
    mcp: {
        command: 'node',
        args: ['sources/modules/mcp-marketplaces/yandex-market.js'],
        env: {
            YANDEX_MARKET_API_KEY: 'secret?:yandex_market_api_key',
            YANDEX_MARKET_CAMPAIGN_ID: 'secret?:yandex_market_campaign_id',
        },
    },
};
