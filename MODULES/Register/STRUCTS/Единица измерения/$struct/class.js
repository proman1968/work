export default {
    label: 'Единица измерения',
    icon: 'carbon:ruler',
    METADATA: {
        FIELDS: [
            { id: 'unit', label: 'Единица', type: 'string', required: true },
            { id: 'coef', label: 'Коэффициент к базовой', type: 'number', required: true },
            { id: 'price', label: 'Цена продажи за единицу', type: 'money' },
        ],
    },
}
