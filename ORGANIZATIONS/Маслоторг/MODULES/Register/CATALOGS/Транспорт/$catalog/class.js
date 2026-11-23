export default {
    label: 'Транспорт',
    icon: 'carbon:delivery',
    METADATA: {
        FIELDS: [
            {
                id: 'kind',
                label: 'Вид',
                type: 'enum',
                values: ['Бензовоз', 'Фургон', 'Легковой'],
                required: true,
            },
            { id: 'capacity', label: 'Грузоподъёмность, л', type: 'number' },
            { id: 'fuel', label: 'Топливо', type: 'link', target: '/MODULES/Register/CATALOGS/Номенклатура' },
        ],
    },
}
