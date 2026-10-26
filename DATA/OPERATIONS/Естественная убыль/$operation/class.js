export default {    label: 'Естественная убыль',
    icon: 'carbon:warning',
    METADATA: {
        FIELDS: [
            { id: 'storage', label: 'Склад', type: 'Link', target: '/DATA/CATALOGS/Склады и резервуары', required: true },
            { id: 'item', label: 'Номенклатура', type: 'Link', target: '/DATA/CATALOGS/Номенклатура', required: true },
            { id: 'batch', label: 'Партия', type: 'Link', target: '/DATA/CATALOGS/Партии' },
            { id: 'base', label: 'База расчёта, в базовых единицах', type: 'Number', required: true },
            { id: 'cost', label: 'Учётная цена за базовую единицу (пусто — по средней)', type: 'Money' },
        ],
        POSTINGS: [
            {
                id: 'loss',
                amount: "round(base * norm('Норма естественной убыли', item) * if(cost, cost, unit_cost('/DATA/REGISTER/41', item, storage, batch)), 2)",
                qty: "round(base * norm('Норма естественной убыли', item), 3)",
                debit: { account: '/DATA/REGISTER/94', analytics: { item: 'item', storage: 'storage' } },
                credit: { account: '/DATA/REGISTER/41', analytics: { item: 'item', storage: 'storage', batch: 'batch' } },
            },
        ],
    },
}
