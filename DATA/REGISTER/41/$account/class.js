export default {
    CID: 'acc.41',
    label: '41.00 Товары',
    icon: 'carbon:product',
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
            { id: 'batch', label: 'Партия', type: 'Link', target: 'cat.batches', analytic: true },
        ],
    },
}
