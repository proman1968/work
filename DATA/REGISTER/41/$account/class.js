export default {    label: '41.00 Товары',
    icon: 'carbon:product',
    METADATA: {
        FIELDS: [
            {
                id: 'item',
                label: 'Номенклатура',
                type: 'Link',
                target: '/DATA/CATALOGS/Номенклатура',
                analytic: true,
                required: true,
            },
            {
                id: 'storage',
                label: 'Склад',
                type: 'Link',
                target: '/DATA/CATALOGS/Склады и резервуары',
                analytic: true,
                required: true,
            },
            { id: 'batch', label: 'Партия', type: 'Link', target: '/DATA/CATALOGS/Партии', analytic: true },
        ],
    },
}
