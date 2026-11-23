export default {
    label: 'Виды нормативов',
    icon: 'carbon:calculator',
    METADATA: {
        FIELDS: [
            { id: 'unit', label: 'Единица измерения', type: 'string' },
            { id: 'default_value', label: 'Значение по умолчанию', type: 'number' },
            { id: 'comment', label: 'Комментарий', type: 'text' },
        ],
    },
}
