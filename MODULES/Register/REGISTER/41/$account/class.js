export default {
    label: '41 Товары',
    icon: 'carbon:product',
    METADATA: {
        FIELDS: [
            {
                id: 'item',
                label: 'Номенклатура',
                type: 'link',
                target: '/MODULES/Register/CATALOGS/Номенклатура',
                analytic: true,
                required: true,
            },
            {
                id: 'storage',
                label: 'Склад',
                type: 'link',
                target: '/MODULES/Register/CATALOGS/Склады',
                analytic: true,
                required: true,
            },
            { id: 'batch', label: 'Партия', type: 'link', target: '/MODULES/Register/CATALOGS/Партии', analytic: true },
        ],
    },
}
