export default {    label: 'Партии',
    icon: 'carbon:batch-job',
    METADATA: {
        FIELDS: [
            { id: 'item', label: 'Номенклатура', type: 'Link', target: '/MODULES/Register/CATALOGS/Номенклатура', required: true },
            { id: 'supplier', label: 'Поставщик', type: 'Link', target: '/MODULES/Register/CATALOGS/Субъекты' },
            { id: 'received', label: 'Дата поступления', type: 'Date' },
            { id: 'density', label: 'Плотность, кг/л', type: 'Number' },
            { id: 'certificate', label: 'Паспорт качества' },
            { id: 'expires', label: 'Годен до', type: 'Date' },
        ],
    },
}
