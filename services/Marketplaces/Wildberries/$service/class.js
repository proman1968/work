/**
 * Wildberries Seller MCP (/SERVICES/Marketplaces/Wildberries).
 * Секрет сохраняется в #secret/wb_api_token.
 */
export default {
    icon: 'carbon:store',
    label: 'Wildberries Seller MCP',
    description: 'Карточки товаров, цены и скидки, склады, остатки FBS, заказы и статистика продаж Wildberries',
    capabilities: ['marketplace', 'wildberries', 'wb', 'ecommerce'],
    enabled: true,
    mcp: {
        command: 'node',
        args: ['sources/modules/mcp-marketplaces/wildberries.js'],
        env: {
            WB_API_TOKEN: 'secret?:wb_api_token',
        },
    },
};
