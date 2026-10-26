export default {    label: 'Перемещение',
    icon: 'carbon:arrows-horizontal',
    METADATA: {
        FIELDS: [
            { id: 'from_storage', label: 'Откуда', type: 'Link', target: '/DATA/CATALOGS/Склады и резервуары', required: true },
            { id: 'to_storage', label: 'Куда', type: 'Link', target: '/DATA/CATALOGS/Склады и резервуары', required: true },
            {
                id: 'lines',
                label: 'Товары',
                type: 'Table',
                required: true,
                FIELDS: [
                    { id: 'item', label: 'Номенклатура', type: 'Link', target: '/DATA/CATALOGS/Номенклатура', required: true },
                    { id: 'unit', label: 'Единица', required: true },
                    { id: 'qty', label: 'Количество', type: 'Number', required: true },
                    { id: 'price', label: 'Учётная цена за единицу (пусто — по средней)', type: 'Money' },
                    { id: 'batch', label: 'Партия', type: 'Link', target: '/DATA/CATALOGS/Партии' },
                ],
            },
        ],
        POSTINGS: [
            {
                id: 'move',
                each: 'lines',
                amount: "row.qty * if(row.price, row.price, coef(row.item, row.unit) * unit_cost('/DATA/REGISTER/41', row.item, from_storage, row.batch))",
                qty: 'row.qty',
                unit: 'row.unit',
                item: 'row.item',
                debit: {
                    account: '/DATA/REGISTER/41',
                    analytics: { item: 'row.item', storage: 'to_storage', batch: 'row.batch' },
                },
                credit: {
                    account: '/DATA/REGISTER/41',
                    analytics: { item: 'row.item', storage: 'from_storage', batch: 'row.batch' },
                },
            },
        ],
    },
}
