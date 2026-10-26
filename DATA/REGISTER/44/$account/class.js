export default {    label: '44.00 Расходы на продажу',
    icon: 'carbon:delivery',
    METADATA: {
        FIELDS: [
            {
                id: 'vehicle',
                label: 'Транспорт',
                type: 'Link',
                target: '/DATA/CATALOGS/Транспорт',
                analytic: true,
                required: true,
            },
        ],
    },
}
