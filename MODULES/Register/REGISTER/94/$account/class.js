export default {    label: '94 Недостачи и потери',
    icon: 'carbon:warning',
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
        ],
    },
}
