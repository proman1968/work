export default {
    label: 'Поступление товара',
    icon: 'carbon:delivery-truck',
    METADATA: {
        FIELDS: [
            { id: 'supplier', label: 'Поставщик', type: 'link', target: '/MODULES/Register/CATALOGS/Поставщики', required: true },
            { id: 'contract', label: 'Договор', type: 'link', target: '/MODULES/Register/CATALOGS/Договоры' },
            { id: 'storage', label: 'Склад', type: 'link', target: '/MODULES/Register/CATALOGS/Склады', required: true },
            { id: 'doc_number', label: 'Номер документа', type: 'string' },
            { id: 'vat_sum', label: 'НДС', type: 'money' },
            {
                id: 'lines',
                label: 'Товары',
                table: true,
                required: true,
                FIELDS: [
                    { id: 'item', label: 'Номенклатура', type: 'link', target: '/MODULES/Register/CATALOGS/Номенклатура', required: true },
                    { id: 'unit', label: 'Единица', type: 'string', required: true },
                    { id: 'qty', label: 'Количество', type: 'number', required: true },
                    { id: 'price', label: 'Цена за единицу', type: 'money', required: true },
                    { id: 'batch', label: 'Партия', type: 'link', target: '/MODULES/Register/CATALOGS/Партии' },
                    { id: 'density', label: 'Плотность, кг/л', type: 'number' },
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
                credit: { account: '/MODULES/Register/REGISTER/60', analytics: { counterparty: 'supplier', contract: 'contract' } },
            },
            {
                id: 'vat',
                when: 'vat_sum > 0',
                amount: 'vat_sum',
                debit: { account: '/MODULES/Register/REGISTER/19' },
                credit: { account: '/MODULES/Register/REGISTER/60', analytics: { counterparty: 'supplier', contract: 'contract' } },
            },
        ],
    },
}
