export default {
    CID: 'op.shrinkage',
    label: 'Естественная убыль',
    icon: 'carbon:warning',
    METADATA: {
        FIELDS: [
            { id: 'storage', label: 'Склад', type: 'Link', target: 'cat.storages', required: true },
            { id: 'item', label: 'Номенклатура', type: 'Link', target: 'cat.items', required: true },
            { id: 'batch', label: 'Партия', type: 'Link', target: 'cat.batches' },
            { id: 'base', label: 'База расчёта, в базовых единицах', type: 'Number', required: true },
            { id: 'cost', label: 'Учётная цена за базовую единицу (пусто — по средней)', type: 'Money' },
        ],
        POSTINGS: [
            {
                id: 'loss',
                amount: "round(base * norm('Норма естественной убыли', item) * if(cost, cost, unit_cost('acc.41', item, storage, batch)), 2)",
                qty: "round(base * norm('Норма естественной убыли', item), 3)",
                debit: { account: 'acc.94', analytics: { item: 'item', storage: 'storage' } },
                credit: { account: 'acc.41', analytics: { item: 'item', storage: 'storage', batch: 'batch' } },
            },
        ],
    },
}
