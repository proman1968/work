export default {
    label: 'Номенклатура',
    icon: 'carbon:box',
    METADATA: {
        FIELDS: [
            {
                id: 'kind',
                label: 'Вид',
                type: 'enum',
                values: ['Масло', 'Топливо', 'Тара', 'Товар', 'Продукция', 'Материал', 'Услуга', 'Работа', 'ОС'],
                required: true,
            },
            { id: 'density', label: 'Плотность (кг/л)', type: 'number' },
        ],
    },
}
