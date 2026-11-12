export default {
    label: '04 Нематериальные активы',
    icon: 'carbon:certificate',
    METADATA: {
        FIELDS: [
            { id: 'asset', label: 'Объект НМА', type: 'Link', target: '/MODULES/Register/CATALOGS/Номенклатура', analytic: true },
        ],
    },
}
