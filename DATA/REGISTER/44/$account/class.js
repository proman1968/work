export default {
    CID: 'acc.44',
    label: '44.00 Расходы на продажу',
    icon: 'carbon:delivery',
    METADATA: {
        FIELDS: [
            {
                id: 'vehicle',
                label: 'Транспорт',
                type: 'Link',
                target: 'cat.vehicles',
                analytic: true,
                required: true,
            },
        ],
    },
}
