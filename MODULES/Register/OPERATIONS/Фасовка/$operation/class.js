export default {    label: 'Фасовка',
    icon: 'carbon:tool-box',
    METADATA: {
        FIELDS: [
            { id: 'item', label: 'Продукт', type: 'Link', target: '/MODULES/Register/CATALOGS/Номенклатура', required: true },
            { id: 'batch', label: 'Партия', type: 'Link', target: '/MODULES/Register/CATALOGS/Партии' },
            {
                id: 'from_storage',
                label: 'Из резервуара',
                type: 'Link',
                target: '/MODULES/Register/CATALOGS/Склады и резервуары',
                required: true,
            },
            { id: 'to_storage', label: 'На склад', type: 'Link', target: '/MODULES/Register/CATALOGS/Склады и резервуары', required: true },
            { id: 'price', label: 'Учётная цена за базовую единицу (пусто — по средней)', type: 'Money' },
            {
                id: 'lines',
                label: 'Фасовано',
                type: 'Table',
                required: true,
                FIELDS: [
                    { id: 'unit', label: 'Тара (единица)', required: true },
                    { id: 'qty', label: 'Количество тары', type: 'Number', required: true },
                    { id: 'container', label: 'Тара', type: 'Link', target: '/MODULES/Register/CATALOGS/Номенклатура', required: true },
                    { id: 'container_cost', label: 'Цена тары (пусто — по средней)', type: 'Money' },
                ],
            },
        ],
        POSTINGS: [
            {
                id: 'product',
                each: 'lines',
                amount: "round(row.qty * coef(item, row.unit) * if(price, price, unit_cost('/MODULES/Register/REGISTER/41', item, from_storage, batch)), 2)",
                qty: 'row.qty',
                unit: 'row.unit',
                item: 'item',
                debit: { account: '/MODULES/Register/REGISTER/41', analytics: { item: 'item', storage: 'to_storage', batch: 'batch' } },
                credit: { account: '/MODULES/Register/REGISTER/41', analytics: { item: 'item', storage: 'from_storage', batch: 'batch' } },
            },
            {
                id: 'tare_in',
                each: 'lines',
                amount: "row.qty * if(row.container_cost, row.container_cost, unit_cost('/MODULES/Register/REGISTER/41', row.container, to_storage))",
                qty: 'row.qty',
                debit: { account: '/MODULES/Register/REGISTER/20' },
                credit: { account: '/MODULES/Register/REGISTER/41', analytics: { item: 'row.container', storage: 'to_storage', batch: "''" } },
            },
            {
                id: 'tare_out',
                each: 'lines',
                amount: "row.qty * if(row.container_cost, row.container_cost, unit_cost('/MODULES/Register/REGISTER/41', row.container, to_storage))",
                debit: { account: '/MODULES/Register/REGISTER/41', analytics: { item: 'item', storage: 'to_storage', batch: 'batch' } },
                credit: { account: '/MODULES/Register/REGISTER/20' },
            },
        ],
    },
}
