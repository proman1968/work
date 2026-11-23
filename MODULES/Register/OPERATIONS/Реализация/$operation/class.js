export default {
    label: 'Реализация',
    icon: 'carbon:shopping-cart',
    METADATA: {
        FIELDS: [
            { id: 'client', label: 'Покупатель', type: 'link', target: '/MODULES/Register/CATALOGS/Клиенты', required: true },
            { id: 'contract', label: 'Договор', type: 'link', target: '/MODULES/Register/CATALOGS/Договоры' },
            { id: 'storage', label: 'Склад отгрузки', type: 'link', target: '/MODULES/Register/CATALOGS/Склады', required: true },
            { id: 'doc_number', label: 'Номер документа', type: 'string' },
            {
                id: 'lines',
                label: 'Товары',
                table: true,
                required: true,
                FIELDS: [
                    { id: 'item', label: 'Номенклатура', type: 'link', target: '/MODULES/Register/CATALOGS/Номенклатура', required: true },
                    { id: 'unit', label: 'Единица', type: 'string', required: true },
                    { id: 'qty', label: 'Количество', type: 'number', required: true },
                    { id: 'price', label: 'Цена за единицу без НДС', type: 'money', required: true },
                    { id: 'cost', label: 'Себестоимость единицы (пусто — по средней)', type: 'money' },
                    { id: 'batch', label: 'Партия', type: 'link', target: '/MODULES/Register/CATALOGS/Партии' },
                ],
            },
        ],
    },
}
