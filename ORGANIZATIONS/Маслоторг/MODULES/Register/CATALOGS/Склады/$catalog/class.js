export default {
    label: 'Склады и резервуары',
    icon: 'carbon:store',
    METADATA: {
        FIELDS: [
            {
                id: 'kind',
                label: 'Вид',
                type: 'enum',
                values: ['Склад', 'Резервуар', 'Цистерна', 'Площадка'],
                required: true,
            },
            { id: 'capacity', label: 'Ёмкость, л', type: 'number' },
            { id: 'item', label: 'Продукт', type: 'link', target: '/MODULES/Register/CATALOGS/Номенклатура' },
        ],
    },
}
