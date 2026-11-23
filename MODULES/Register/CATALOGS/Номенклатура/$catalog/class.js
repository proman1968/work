export default {
    label: 'Номенклатура',
    icon: 'carbon:box',
    METADATA: {
        FIELDS: [
            { id: 'sku', label: 'Артикул', type: 'string' },
            {
                id: 'kind',
                label: 'Вид',
                type: 'enum',
                values: ['Товар', 'Продукция', 'Материал', 'Тара', 'Услуга', 'Работа', 'ОС'],
                required: true,
            },
            { id: 'base_unit', label: 'Базовая единица', type: 'string', required: true },
            {
                id: 'vat_rate',
                label: 'Ставка НДС',
                type: 'enum',
                values: ['20%', '10%', '0%', 'Без НДС'],
            },
            { id: 'units', label: 'Единицы измерения', type: '/MODULES/Register/STRUCTS/Единица измерения', table: true },
        ],
    },
}
