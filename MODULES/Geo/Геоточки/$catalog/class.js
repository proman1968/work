export default {
    label: 'Геоточки',
    icon: 'carbon:map',
    $public: {
        form: 'objects',
    },
    types: ['/MODULES/Geo/Карта'],
    METADATA: {
        FIELDS: [
            { id: 'name', label: 'Название', type: 'string', required: true },
            {
                id: 'category',
                label: 'Категория',
                type: 'enum',
                values: ['Офис', 'Склад', 'Магазин', 'Клиент', 'Объект', 'Маршрут'],
            },
            { id: 'address', label: 'Адрес', type: 'text' },
        ],
    },
}
