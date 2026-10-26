export default {    label: 'Транспорт',
    icon: 'carbon:delivery',
    METADATA: {
        FIELDS: [
            { id: 'plate', label: 'Госномер', required: true },
            {
                id: 'kind',
                label: 'Вид',
                type: 'Enum',
                values: ['Бензовоз', 'Фургон', 'Легковой'],
                required: true,
            },
            { id: 'capacity', label: 'Грузоподъёмность, л', type: 'Number' },
            { id: 'driver', label: 'Водитель', type: 'Link', target: '/DATA/CATALOGS/Сотрудники' },
            { id: 'fuel', label: 'Топливо', type: 'Link', target: '/DATA/CATALOGS/Номенклатура' },
        ],
    },
}
