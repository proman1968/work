export default {    label: 'Установка норматива',
    icon: 'carbon:calculator',
    AUTO_REGISTER: true,
    METADATA: {
        FIELDS: [
            { id: 'kind', label: 'Вид норматива', type: 'Link', target: '/MODULES/Register/CATALOGS/Виды нормативов', required: true },
            { id: 'object', label: 'Объект', type: 'Link', target: '/MODULES/Register/CATALOGS' },
            { id: 'value', label: 'Значение', type: 'Number', required: true },
        ],
        POSTINGS: [
            {
                id: 'norm',
                qty: 'value - norm(kind, object, 0)',
                debit: { account: '/MODULES/Register/REGISTER/Нормативы', analytics: { kind: 'kind', object: 'object' } },
                credit: { account: '/MODULES/Register/REGISTER/Технический' },
            },
        ],
    },
}
