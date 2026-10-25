export default {
    CID: 'op.transfer',
    label: 'Перемещение',
    icon: 'carbon:arrows-horizontal',
    METADATA: {
        FIELDS: [
            { id: 'from_storage', label: 'Откуда', type: 'Link', target: 'cat.storages', required: true },
            { id: 'to_storage', label: 'Куда', type: 'Link', target: 'cat.storages', required: true },
            {
                id: 'lines',
                label: 'Товары',
                type: 'Table',
                required: true,
                FIELDS: [
                    { id: 'item', label: 'Номенклатура', type: 'Link', target: 'cat.items', required: true },
                    { id: 'unit', label: 'Единица', required: true },
                    { id: 'qty', label: 'Количество', type: 'Number', required: true },
                    { id: 'price', label: 'Учётная цена за единицу (пусто — по средней)', type: 'Money' },
                    { id: 'batch', label: 'Партия', type: 'Link', target: 'cat.batches' },
                ],
            },
        ],
        POSTINGS: [
            {
                id: 'move',
                each: 'lines',
                amount: "row.qty * if(row.price, row.price, coef(row.item, row.unit) * unit_cost('acc.41', row.item, from_storage, row.batch))",
                qty: 'row.qty',
                unit: 'row.unit',
                item: 'row.item',
                debit: {
                    account: 'acc.41',
                    analytics: { item: 'row.item', storage: 'to_storage', batch: 'row.batch' },
                },
                credit: {
                    account: 'acc.41',
                    analytics: { item: 'row.item', storage: 'from_storage', batch: 'row.batch' },
                },
            },
        ],
    },
}
