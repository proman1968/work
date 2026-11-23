export default {
    label: 'Транспорт',
    icon: 'carbon:delivery',
    types: ['/MODULES/Geo/Карта'],
    METADATA: {
        FIELDS: [
            { id: 'plate', label: 'Госномер', type: 'string', required: true },
            {
                id: 'kind',
                label: 'Вид',
                type: 'enum',
                values: ['Легковой', 'Фургон', 'Грузовой', 'Спецтехника'],
                required: true,
            },
            { id: 'payload_kg', label: 'Грузоподъёмность, кг', type: 'number' },
            { id: 'driver', label: 'Водитель', type: 'link', target: '/MODULES/Register/CATALOGS/Сотрудники' },
        ],
    },
}
