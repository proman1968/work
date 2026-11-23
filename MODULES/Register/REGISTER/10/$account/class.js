export default {
    label: '10 Материалы',
    icon: 'carbon:box',
    METADATA: {
        FIELDS: [
            {
                id: 'item',
                label: 'Номенклатура',
                type: 'link',
                target: '/MODULES/Register/CATALOGS/Номенклатура',
                analytic: true,
            },
            {
                id: 'storage',
                label: 'Склад',
                type: 'link',
                target: '/MODULES/Register/CATALOGS/Склады',
                analytic: true,
                optional: true,
            },
        ],
    },
}
