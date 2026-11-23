export default {
    label: 'Списание ТМЦ',
    icon: 'carbon:warning',
    METADATA: {
        FIELDS: [
            { id: 'storage', label: 'Склад', type: 'link', target: '/MODULES/Register/CATALOGS/Склады', required: true },
            { id: 'item', label: 'Номенклатура', type: 'link', target: '/MODULES/Register/CATALOGS/Номенклатура', required: true },
            { id: 'batch', label: 'Партия', type: 'link', target: '/MODULES/Register/CATALOGS/Партии' },
            {
                id: 'reason',
                label: 'Причина списания',
                type: 'enum',
                values: ['Порча / Брак', 'Недостача', 'Хозяйственные нужды', 'Естественная убыль'],
            },
            { id: 'qty', label: 'Количество в базовых единицах', type: 'number', required: true },
            { id: 'cost', label: 'Учётная цена за базовую единицу (пусто — по средней)', type: 'money' },
        ],
        POSTINGS: [
            {
                id: 'writeoff',
                amount: "round(qty * if(cost, cost, unit_cost('/MODULES/Register/REGISTER/41', item, storage, batch)), 2)",
                qty: 'qty',
                debit: { account: '/MODULES/Register/REGISTER/94', analytics: { item: 'item', storage: 'storage' } },
                credit: { account: '/MODULES/Register/REGISTER/41', analytics: { item: 'item', storage: 'storage', batch: 'batch' } },
            },
        ],
    },
}
