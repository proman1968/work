export default {
    label: '60 Расчёты с поставщиками',
    icon: 'carbon:wallet',
    METADATA: {
        FIELDS: [
            {
                id: 'counterparty',
                label: 'Контрагент',
                type: 'link',
                target: '/MODULES/Register/CATALOGS/Субъекты',
                analytic: true,
                required: true,
            },
            {
                id: 'contract',
                label: 'Договор',
                type: 'link',
                target: '/MODULES/Register/CATALOGS/Договоры',
                analytic: true,
                optional: true,
            },
        ],
    },
}
