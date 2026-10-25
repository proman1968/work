export default {
    CID: 'op.sales',
    label: 'Реализация',
    icon: 'carbon:shopping-cart',
    METADATA: {
        FIELDS: [
            { id: 'client', label: 'Покупатель', type: 'Link', target: 'cat.clients', required: true },
            { id: 'contract', label: 'Договор', type: 'Link', target: 'cat.contracts' },
            { id: 'storage', label: 'Склад отгрузки', type: 'Link', target: 'cat.storages', required: true },
            { id: 'doc_number', label: 'Номер документа' },
            {
                id: 'lines',
                label: 'Товары',
                type: 'Table',
                required: true,
                FIELDS: [
                    { id: 'item', label: 'Номенклатура', type: 'Link', target: 'cat.items', required: true },
                    { id: 'unit', label: 'Единица', required: true },
                    { id: 'qty', label: 'Количество', type: 'Number', required: true },
                    { id: 'price', label: 'Цена за единицу без НДС', type: 'Money', required: true },
                    { id: 'cost', label: 'Себестоимость единицы (пусто — по средней)', type: 'Money' },
                    { id: 'batch', label: 'Партия', type: 'Link', target: 'cat.batches' },
                ],
            },
        ],
    },
}
