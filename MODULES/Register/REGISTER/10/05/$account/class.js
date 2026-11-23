export default {
    label: '10.05 Запасные части и ГСМ',
    icon: 'carbon:gas-station',
    METADATA: {
        FIELDS: [
            { id: 'item', label: 'Материал / запчасть', type: 'link', target: '/MODULES/Register/CATALOGS/Номенклатура', analytic: true },
        ],
    },
}
