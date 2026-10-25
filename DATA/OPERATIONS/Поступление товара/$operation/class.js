export default {
    CID: 'op.receipt',
    label: 'Поступление товара',
    icon: 'carbon:delivery-truck',
    METADATA: {
        FIELDS: [
            { id: 'supplier', label: 'Поставщик', type: 'Link', target: 'cat.suppliers', required: true },
            { id: 'contract', label: 'Договор', type: 'Link', target: 'cat.contracts' },
            { id: 'storage', label: 'Склад', type: 'Link', target: 'cat.storages', required: true },
            { id: 'doc_number', label: 'Номер документа' },
            { id: 'vat_sum', label: 'НДС', type: 'Money' },
            {
                id: 'lines',
                label: 'Товары',
                type: 'Table',
                required: true,
                FIELDS: [
                    { id: 'item', label: 'Номенклатура', type: 'Link', target: 'cat.items', required: true },
                    { id: 'unit', label: 'Единица', required: true },
                    { id: 'qty', label: 'Количество', type: 'Number', required: true },
                    { id: 'price', label: 'Цена за единицу', type: 'Money', required: true },
                    { id: 'batch', label: 'Партия', type: 'Link', target: 'cat.batches' },
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
                debit: { account: 'acc.41', analytics: { item: 'row.item', storage: 'storage', batch: 'row.batch' } },
                credit: { account: 'acc.60', analytics: { counterparty: 'supplier' } },
            },
            {
                id: 'vat',
                when: 'vat_sum > 0',
                amount: 'vat_sum',
                debit: { account: 'acc.19' },
                credit: { account: 'acc.60', analytics: { counterparty: 'supplier' } },
            },
        ],
    },
}
