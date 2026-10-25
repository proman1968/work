export default {
    CID: 'cat.batches',
    label: 'Партии',
    icon: 'carbon:batch-job',
    METADATA: {
        FIELDS: [
            { id: 'item', label: 'Номенклатура', type: 'Link', target: 'cat.items', required: true },
            { id: 'supplier', label: 'Поставщик', type: 'Link', target: 'cat.subjects' },
            { id: 'received', label: 'Дата поступления', type: 'Date' },
            { id: 'density', label: 'Плотность, кг/л', type: 'Number' },
            { id: 'certificate', label: 'Паспорт качества' },
            { id: 'expires', label: 'Годен до', type: 'Date' },
        ],
    },
}
