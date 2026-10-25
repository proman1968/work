export default {
    CID: 'op.packing',
    label: 'Фасовка',
    icon: 'carbon:tool-box',
    METADATA: {
        FIELDS: [
            { id: 'item', label: 'Продукт', type: 'Link', target: 'cat.items', required: true },
            { id: 'batch', label: 'Партия', type: 'Link', target: 'cat.batches' },
            {
                id: 'from_storage',
                label: 'Из резервуара',
                type: 'Link',
                target: 'cat.storages',
                required: true,
            },
            { id: 'to_storage', label: 'На склад', type: 'Link', target: 'cat.storages', required: true },
            { id: 'price', label: 'Учётная цена за базовую единицу (пусто — по средней)', type: 'Money' },
            {
                id: 'lines',
                label: 'Фасовано',
                type: 'Table',
                required: true,
                FIELDS: [
                    { id: 'unit', label: 'Тара (единица)', required: true },
                    { id: 'qty', label: 'Количество тары', type: 'Number', required: true },
                    { id: 'container', label: 'Тара', type: 'Link', target: 'cat.items', required: true },
                    { id: 'container_cost', label: 'Цена тары (пусто — по средней)', type: 'Money' },
                ],
            },
        ],
        POSTINGS: [
            {
                id: 'product',
                each: 'lines',
                amount: "round(row.qty * coef(item, row.unit) * if(price, price, unit_cost('acc.41', item, from_storage, batch)), 2)",
                qty: 'row.qty',
                unit: 'row.unit',
                item: 'item',
                debit: { account: 'acc.41', analytics: { item: 'item', storage: 'to_storage', batch: 'batch' } },
                credit: { account: 'acc.41', analytics: { item: 'item', storage: 'from_storage', batch: 'batch' } },
            },
            {
                id: 'tare_in',
                each: 'lines',
                amount: "row.qty * if(row.container_cost, row.container_cost, unit_cost('acc.41', row.container, to_storage))",
                qty: 'row.qty',
                debit: { account: 'acc.20' },
                credit: { account: 'acc.41', analytics: { item: 'row.container', storage: 'to_storage', batch: "''" } },
            },
            {
                id: 'tare_out',
                each: 'lines',
                amount: "row.qty * if(row.container_cost, row.container_cost, unit_cost('acc.41', row.container, to_storage))",
                debit: { account: 'acc.41', analytics: { item: 'item', storage: 'to_storage', batch: 'batch' } },
                credit: { account: 'acc.20' },
            },
        ],
    },
}
