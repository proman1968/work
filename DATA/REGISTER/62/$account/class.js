export default {    label: '62.00 Расчёты с покупателями',
    icon: 'carbon:wallet',
    METADATA: {
        FIELDS: [
            {
                id: 'counterparty',
                label: 'Контрагент',
                type: 'Link',
                target: '/DATA/CATALOGS/Субъекты',
                analytic: true,
                required: true,
            },
        ],
    },
}
