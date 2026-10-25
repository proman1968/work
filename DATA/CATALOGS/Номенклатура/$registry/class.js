export default {
    CID: 'cat.items',
    label: 'Номенклатура',
    icon: 'carbon:product',
    METADATA: {
        FIELDS: [
            { id: 'sku', label: 'Артикул' },
            {
                id: 'kind',
                label: 'Вид',
                type: 'Enum',
                values: ['Масло', 'Топливо', 'Тара', 'Услуга'],
                required: true,
            },
            { id: 'base_unit', label: 'Базовая единица', required: true },
            { id: 'density', label: 'Плотность, кг/л', type: 'Number' },
            {
                id: 'units',
                label: 'Единицы',
                type: 'Table',
                FIELDS: [
                    { id: 'unit', label: 'Единица', required: true },
                    { id: 'coef', label: 'Коэффициент к базовой', type: 'Number', required: true },
                    { id: 'price', label: 'Цена', type: 'Money' },
                ],
            },
        ],
    },
}
