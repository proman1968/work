export default {    label: '41 Товары',
    icon: 'carbon:product',
    METADATA: {
        FIELDS: [
            {
                id: 'item',
                label: 'Номенклатура',
                type: 'Link',
                target: '/MODULES/Register/CATALOGS/Номенклатура',
                analytic: true,
                required: true,
            },
            {
                id: 'storage',
                label: 'Склад',
                type: 'Link',
                target: '/MODULES/Register/CATALOGS/Склады и резервуары',
                analytic: true,
                required: true,
            },
            { id: 'batch', label: 'Партия', type: 'Link', target: '/MODULES/Register/CATALOGS/Партии', analytic: true },
        ],
    },
}
