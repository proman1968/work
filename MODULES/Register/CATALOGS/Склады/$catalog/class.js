export default {
    label: 'Склады',
    icon: 'carbon:store',
    types: ['/MODULES/Geo/Карта'],
    METADATA: {
        FIELDS: [
            {
                id: 'kind',
                label: 'Вид',
                type: 'enum',
                values: ['Склад', 'Офис', 'Магазин', 'Производство', 'Площадка'],
                required: true,
            },
            { id: 'address', label: 'Адрес', type: '/MODULES/Register/STRUCTS/Адрес' },
        ],
    },
}
