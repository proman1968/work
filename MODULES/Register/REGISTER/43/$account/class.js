export default {
    label: '43 Готовая продукция',
    icon: 'carbon:product',
    METADATA: {
        FIELDS: [
            { id: 'item', label: 'Продукция', type: 'link', target: '/MODULES/Register/CATALOGS/Номенклатура', analytic: true },
            { id: 'storage', label: 'Склад', type: 'link', target: '/MODULES/Register/CATALOGS/Склады', analytic: true },
        ],
    },
}
