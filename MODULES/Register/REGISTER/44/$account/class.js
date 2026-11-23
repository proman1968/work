export default {    label: '44 Расходы на продажу',
    icon: 'carbon:delivery',
    METADATA: {
        FIELDS: [
            {
                id: 'vehicle',
                label: 'Транспорт',
                type: 'link',
                target: '/MODULES/Register/CATALOGS/Транспорт',
                analytic: true,
                required: true,
            },
        ],
    },
}
