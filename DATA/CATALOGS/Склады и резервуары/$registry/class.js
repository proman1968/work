export default {
    CID: 'cat.storages',
    label: 'Склады и резервуары',
    icon: 'carbon:store',
    METADATA: {
        FIELDS: [
            {
                id: 'kind',
                label: 'Вид',
                type: 'Enum',
                values: ['Склад', 'Резервуар', 'Цистерна', 'Площадка'],
                required: true,
            },
            { id: 'address', label: 'Адрес', type: 'Text' },
            { id: 'capacity', label: 'Ёмкость, л', type: 'Number' },
            { id: 'item', label: 'Продукт', type: 'Link', target: 'cat.items' },
        ],
    },
}
