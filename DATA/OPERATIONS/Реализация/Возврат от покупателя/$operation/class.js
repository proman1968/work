export default {
    CID: 'op.sales.return',
    label: 'Возврат от покупателя',
    icon: 'carbon:undo',
    METADATA: {
        POSTINGS: [
            {
                id: 'revenue',
                each: 'lines',
                amount: 'row.qty * row.price',
                debit: { account: 'acc.90.01', analytics: { item: 'row.item' } },
                credit: { account: 'acc.62', analytics: { counterparty: 'client' } },
            },
            {
                id: 'vat',
                each: 'lines',
                amount: "round(row.qty * row.price * norm('Ставка НДС', row.item), 2)",
                debit: { account: 'acc.68.02' },
                credit: { account: 'acc.62', analytics: { counterparty: 'client' } },
            },
            {
                id: 'cogs',
                each: 'lines',
                amount: "row.qty * if(row.cost, row.cost, coef(row.item, row.unit) * unit_cost('acc.41', row.item, storage, row.batch))",
                qty: 'row.qty',
                unit: 'row.unit',
                item: 'row.item',
                debit: { account: 'acc.41', analytics: { item: 'row.item', storage: 'storage', batch: 'row.batch' } },
                credit: { account: 'acc.90.02', analytics: { item: 'row.item' } },
            },
        ],
    },
}
