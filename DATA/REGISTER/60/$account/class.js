export default {
    CID: 'acc.60',
    label: '60.00 Расчёты с поставщиками',
    icon: 'carbon:wallet',
    METADATA: {
        FIELDS: [
            {
                id: 'counterparty',
                label: 'Контрагент',
                type: 'Link',
                target: 'cat.subjects',
                analytic: true,
                required: true,
            },
        ],
    },
}
