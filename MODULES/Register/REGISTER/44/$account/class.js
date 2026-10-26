export default {    label: '44.00 Расходы на продажу',
    icon: 'carbon:delivery',
    METADATA: {
        FIELDS: [
            {
                id: 'vehicle',
                label: 'Транспорт',
                type: 'Link',
                target: '/MODULES/Register/CATALOGS/Транспорт',
                analytic: true,
                required: true,
            },
        ],
    },
}
