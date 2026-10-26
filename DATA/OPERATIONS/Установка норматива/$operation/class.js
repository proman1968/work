export default {    label: 'Установка норматива',
    icon: 'carbon:calculator',
    AUTO_REGISTER: true,
    METADATA: {
        FIELDS: [
            { id: 'kind', label: 'Вид норматива', type: 'Link', target: '/DATA/CATALOGS/Виды нормативов', required: true },
            { id: 'object', label: 'Объект', type: 'Link', target: '/DATA/CATALOGS' },
            { id: 'value', label: 'Значение', type: 'Number', required: true },
        ],
        POSTINGS: [
            {
                id: 'norm',
                qty: 'value - norm(kind, object, 0)',
                debit: { account: '/DATA/REGISTER/Нормативы', analytics: { kind: 'kind', object: 'object' } },
                credit: { account: '/DATA/REGISTER/Технический' },
            },
        ],
    },
}
