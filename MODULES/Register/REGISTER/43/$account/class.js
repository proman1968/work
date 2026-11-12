export default {
    label: '43 Готовая продукция',
    icon: 'carbon:product',
    METADATA: {
        FIELDS: [
            { id: 'item', label: 'Продукция', type: 'Link', target: '/MODULES/Register/CATALOGS/Номенклатура', analytic: true },
            { id: 'storage', label: 'Склад', type: 'Link', target: '/MODULES/Register/CATALOGS/Склады и резервуары', analytic: true },
        ],
    },
}
