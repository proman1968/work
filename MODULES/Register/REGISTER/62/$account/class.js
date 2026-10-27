export default {    label: '62 Расчёты с покупателями',
    icon: 'carbon:wallet',
    METADATA: {
        FIELDS: [
            {
                id: 'counterparty',
                label: 'Контрагент',
                type: 'Link',
                target: '/MODULES/Register/CATALOGS/Субъекты',
                analytic: true,
                required: true,
            },
        ],
    },
}
