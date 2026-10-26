export default {    label: '94.00 Недостачи и потери',
    icon: 'carbon:warning',
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
        ],
    },
}
