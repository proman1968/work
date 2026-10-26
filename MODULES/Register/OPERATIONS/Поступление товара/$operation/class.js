export default {    label: 'Поступление товара',
    icon: 'carbon:delivery-truck',
    METADATA: {
        FIELDS: [
            { id: 'supplier', label: 'Поставщик', type: 'Link', target: '/MODULES/Register/CATALOGS/Поставщики', required: true },
            { id: 'contract', label: 'Договор', type: 'Link', target: '/MODULES/Register/CATALOGS/Договоры' },
            { id: 'storage', label: 'Склад', type: 'Link', target: '/MODULES/Register/CATALOGS/Склады и резервуары', required: true },
            { id: 'doc_number', label: 'Номер документа' },
            { id: 'vat_sum', label: 'НДС', type: 'Money' },
            {
                id: 'lines',
                label: 'Товары',
                type: 'Table',
                required: true,
                FIELDS: [
                    { id: 'item', label: 'Номенклатура', type: 'Link', target: '/MODULES/Register/CATALOGS/Номенклатура', required: true },
                    { id: 'unit', label: 'Единица', required: true },
                    { id: 'qty', label: 'Количество', type: 'Number', required: true },
                    { id: 'price', label: 'Цена за единицу', type: 'Money', required: true },
                    { id: 'batch', label: 'Партия', type: 'Link', target: '/MODULES/Register/CATALOGS/Партии' },
                    { id: 'density', label: 'Плотность, кг/л', type: 'Number' },
                ],
            },
        ],
        POSTINGS: [
            {
                id: 'lines',
                each: 'lines',
                amount: 'row.qty * row.price',
                qty: 'row.qty',
                unit: 'row.unit',
                item: 'row.item',
                qty2: 'row.qty * coef(row.item, row.unit) * row.density',
                debit: { account: '/MODULES/Register/REGISTER/41', analytics: { item: 'row.item', storage: 'storage', batch: 'row.batch' } },
                credit: { account: '/MODULES/Register/REGISTER/60', analytics: { counterparty: 'supplier' } },
            },
            {
                id: 'vat',
                when: 'vat_sum > 0',
                amount: 'vat_sum',
                debit: { account: '/MODULES/Register/REGISTER/19' },
                credit: { account: '/MODULES/Register/REGISTER/60', analytics: { counterparty: 'supplier' } },
            },
        ],
    },
}
