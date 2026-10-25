export default {
    CID: 'acc.94',
    label: '94.00 Недостачи и потери',
    icon: 'carbon:warning',
    METADATA: {
        FIELDS: [
            {
                id: 'item',
                label: 'Номенклатура',
                type: 'Link',
                target: 'cat.items',
                analytic: true,
                required: true,
            },
            {
                id: 'storage',
                label: 'Склад',
                type: 'Link',
                target: 'cat.storages',
                analytic: true,
                required: true,
            },
        ],
    },
}
