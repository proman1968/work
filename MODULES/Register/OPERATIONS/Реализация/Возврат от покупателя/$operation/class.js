export default {    label: 'Возврат от покупателя',
    icon: 'carbon:undo',
    METADATA: {
        POSTINGS: [
            {
                id: 'revenue',
                each: 'lines',
                amount: 'row.qty * row.price',
                debit: { account: '/MODULES/Register/REGISTER/90/01', analytics: { item: 'row.item' } },
                credit: { account: '/MODULES/Register/REGISTER/62', analytics: { counterparty: 'client' } },
            },
            {
                id: 'vat',
                each: 'lines',
                amount: "round(row.qty * row.price * norm('Ставка НДС', row.item), 2)",
                debit: { account: '/MODULES/Register/REGISTER/68/02' },
                credit: { account: '/MODULES/Register/REGISTER/62', analytics: { counterparty: 'client' } },
            },
            {
                id: 'cogs',
                each: 'lines',
                amount: "row.qty * if(row.cost, row.cost, coef(row.item, row.unit) * unit_cost('/MODULES/Register/REGISTER/41', row.item, storage, row.batch))",
                qty: 'row.qty',
                unit: 'row.unit',
                item: 'row.item',
                debit: { account: '/MODULES/Register/REGISTER/41', analytics: { item: 'row.item', storage: 'storage', batch: 'row.batch' } },
                credit: { account: '/MODULES/Register/REGISTER/90/02', analytics: { item: 'row.item' } },
            },
        ],
    },
}
