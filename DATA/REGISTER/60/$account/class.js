export default {    label: '60.00 Расчёты с поставщиками',
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
