export default {
    CID: 'acc.62',
    label: '62.00 Расчёты с покупателями',
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
