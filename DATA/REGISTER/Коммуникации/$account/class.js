export default {
    CID: 'acc.comm',
    label: 'Коммуникации',
    icon: 'carbon:email',
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
