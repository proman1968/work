/**
 * Ozon Seller MCP (/SERVICES/Marketplaces/Ozon).
 * Секреты сохраняются в #secret/ozon_client_id и #secret/ozon_api_key.
 */
export default {
    icon: 'carbon:shopping-bag',
    label: 'Ozon Seller MCP',
    description: 'Товары, цены, остатки, заказы FBS/FBO, аналитика и финансы через Ozon Seller API',
    capabilities: ['marketplace', 'ozon', 'ecommerce'],
    enabled: true,
    mcp: {
        command: 'node',
        args: ['sources/modules/mcp-marketplaces/ozon.js'],
        env: {
            OZON_CLIENT_ID: 'secret?:ozon_client_id',
            OZON_API_KEY: 'secret?:ozon_api_key',
        },
    },
};
