export default {
    label: 'Номенклатура',
    icon: 'carbon:box',
    METADATA: {
        FIELDS: [
            { id: 'sku', label: 'Артикул' },
            { id: 'kind', label: 'Вид', type: 'enum', values: ['Масло', 'Топливо', 'Тара'], required: true },
            { id: 'base_unit', label: 'Базовая единица', required: true },
            { id: 'density', label: 'Плотность (кг/л)', type: 'Number' },
            { id: 'units', label: 'Единицы измерения', type: '/MODULES/Register/STRUCTS/Единица измерения', table: true },
        ],
    },
}
