export default {
    label: '94 Недостачи и потери',
    icon: 'carbon:warning',
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
        ],
    },
}
