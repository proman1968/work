export default {
    label: '02 Амортизация основных средств',
    icon: 'carbon:chart-line-data',
    METADATA: {
        FIELDS: [
            { id: 'asset', label: 'Основное средство', type: 'Link', target: '/MODULES/Register/CATALOGS/Номенклатура', analytic: true },
        ],
    },
}
