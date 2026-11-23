export default {
    label: 'Передача материалов в производство',
    icon: 'carbon:industry',
    METADATA: {
        FIELDS: [
            { id: 'storage', label: 'Склад материалов', type: 'link', target: '/MODULES/Register/CATALOGS/Склады' },
            { id: 'item', label: 'Материал', type: 'link', target: '/MODULES/Register/CATALOGS/Номенклатура', required: true },
            { id: 'qty', label: 'Количество', type: 'number', required: true },
            { id: 'sum', label: 'Сумма списания', type: 'money', required: true },
        ],
        POSTINGS: [
            {
                id: 'writeoff',
                amount: 'sum',
                qty: 'qty',
                item: 'item',
                debit: { account: '/MODULES/Register/REGISTER/20' },
                credit: { account: '/MODULES/Register/REGISTER/10/01', analytics: { item: 'item', storage: 'storage' } },
            },
        ],
    },
}
