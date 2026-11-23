export default {
    label: 'Партии',
    icon: 'carbon:batch-job',
    METADATA: {
        FIELDS: [
            { id: 'item', label: 'Номенклатура', type: 'link', target: '/MODULES/Register/CATALOGS/Номенклатура', required: true },
            { id: 'supplier', label: 'Поставщик', type: 'link', target: '/MODULES/Register/CATALOGS/Субъекты' },
            { id: 'received', label: 'Дата поступления', type: 'date' },
            { id: 'certificate', label: 'Сертификат / ГТД', type: 'string' },
            { id: 'expires', label: 'Годен до', type: 'date' },
        ],
    },
}
