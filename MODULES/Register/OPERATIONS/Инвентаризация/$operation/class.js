export default {    label: 'Инвентаризация',
    icon: 'carbon:task',
    METADATA: {
        FIELDS: [
            { id: 'storage', label: 'Склад', type: 'Link', target: '/MODULES/Register/CATALOGS/Склады и резервуары', required: true },
            {
                id: 'lines',
                label: 'Расхождения',
                type: 'Table',
                required: true,
                FIELDS: [
                    { id: 'item', label: 'Номенклатура', type: 'Link', target: '/MODULES/Register/CATALOGS/Номенклатура', required: true },
                    { id: 'unit', label: 'Единица', required: true },
                    { id: 'delta', label: 'Излишек (+) / недостача (−)', type: 'Number', required: true },
                    { id: 'cost', label: 'Учётная цена за единицу (пусто — по средней)', type: 'Money' },
                    { id: 'batch', label: 'Партия', type: 'Link', target: '/MODULES/Register/CATALOGS/Партии' },
                ],
            },
        ],
        POSTINGS: [
            {
                id: 'surplus',
                each: 'lines',
                when: 'row.delta > 0',
                amount: "row.delta * if(row.cost, row.cost, coef(row.item, row.unit) * unit_cost('/MODULES/Register/REGISTER/41', row.item, storage, row.batch, 0))",
                qty: 'row.delta',
                unit: 'row.unit',
                item: 'row.item',
                debit: { account: '/MODULES/Register/REGISTER/41', analytics: { item: 'row.item', storage: 'storage', batch: 'row.batch' } },
                credit: { account: '/MODULES/Register/REGISTER/91', analytics: { item: 'row.item' } },
            },
            {
                id: 'shortage',
                each: 'lines',
                when: 'row.delta < 0',
                amount: "abs(row.delta) * if(row.cost, row.cost, coef(row.item, row.unit) * unit_cost('/MODULES/Register/REGISTER/41', row.item, storage, row.batch))",
                qty: 'abs(row.delta)',
                unit: 'row.unit',
                item: 'row.item',
                debit: { account: '/MODULES/Register/REGISTER/94', analytics: { item: 'row.item', storage: 'storage' } },
                credit: { account: '/MODULES/Register/REGISTER/41', analytics: { item: 'row.item', storage: 'storage', batch: 'row.batch' } },
            },
        ],
    },
}
