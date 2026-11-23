export default {
    label: 'Перемещение',
    icon: 'carbon:arrows-horizontal',
    METADATA: {
        FIELDS: [
            { id: 'from_storage', label: 'Откуда', type: 'link', target: '/MODULES/Register/CATALOGS/Склады', required: true },
            { id: 'to_storage', label: 'Куда', type: 'link', target: '/MODULES/Register/CATALOGS/Склады', required: true },
            {
                id: 'lines',
                label: 'Товары',
                table: true,
                required: true,
                FIELDS: [
                    { id: 'item', label: 'Номенклатура', type: 'link', target: '/MODULES/Register/CATALOGS/Номенклатура', required: true },
                    { id: 'unit', label: 'Единица', type: 'string', required: true },
                    { id: 'qty', label: 'Количество', type: 'number', required: true },
                    { id: 'price', label: 'Учётная цена за единицу (пусто — по средней)', type: 'money' },
                    { id: 'batch', label: 'Партия', type: 'link', target: '/MODULES/Register/CATALOGS/Партии' },
                ],
            },
        ],
        POSTINGS: [
            {
                id: 'move',
                each: 'lines',
                amount: "row.qty * if(row.price, row.price, coef(row.item, row.unit) * unit_cost('/MODULES/Register/REGISTER/41', row.item, from_storage, row.batch))",
                qty: 'row.qty',
                unit: 'row.unit',
                item: 'row.item',
                debit: {
                    account: '/MODULES/Register/REGISTER/41',
                    analytics: { item: 'row.item', storage: 'to_storage', batch: 'row.batch' },
                },
                credit: {
                    account: '/MODULES/Register/REGISTER/41',
                    analytics: { item: 'row.item', storage: 'from_storage', batch: 'row.batch' },
                },
            },
        ],
    },
}
