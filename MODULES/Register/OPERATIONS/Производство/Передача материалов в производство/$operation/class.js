export default {
    label: 'Передача материалов в производство',
    icon: 'carbon:industry',
    METADATA: {
        FIELDS: [
            { id: 'item', label: 'Материал', type: 'Link', target: '/MODULES/Register/CATALOGS/Номенклатура', required: true },
            { id: 'qty', label: 'Количество', type: 'Number', required: true },
            { id: 'sum', label: 'Сумма списания', type: 'Money', required: true },
        ],
        POSTINGS: [
            {
                id: 'writeoff',
                amount: 'sum',
                qty: 'qty',
                item: 'item',
                debit: { account: '/MODULES/Register/REGISTER/20' },
                credit: { account: '/MODULES/Register/REGISTER/10/01', analytics: { item: 'item' } },
            },
        ],
    },
}
