export default {
    label: 'Выпуск готовой продукции',
    icon: 'carbon:product',
    METADATA: {
        FIELDS: [
            { id: 'storage', label: 'Склад готовой продукции', type: 'Link', target: '/MODULES/Register/CATALOGS/Склады и резервуары', required: true },
            { id: 'item', label: 'Продукция', type: 'Link', target: '/MODULES/Register/CATALOGS/Номенклатура', required: true },
            { id: 'qty', label: 'Количество', type: 'Number', required: true },
            { id: 'sum', label: 'Плановая / фактическая себестоимость', type: 'Money', required: true },
        ],
        POSTINGS: [
            {
                id: 'output',
                amount: 'sum',
                qty: 'qty',
                item: 'item',
                debit: { account: '/MODULES/Register/REGISTER/43', analytics: { item: 'item', storage: 'storage' } },
                credit: { account: '/MODULES/Register/REGISTER/20' },
            },
        ],
    },
}
