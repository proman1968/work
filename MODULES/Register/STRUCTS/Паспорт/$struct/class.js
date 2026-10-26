export default {
    label: 'Паспорт',
    icon: 'carbon:identification',
    METADATA: {
        FIELDS: [
            { id: 'series', label: 'Серия', type: 'string' },
            { id: 'number', label: 'Номер', type: 'string' },
            { id: 'address', label: 'Адрес регистрации', type: '/MODULES/Register/STRUCTS/Адрес' },
        ],
    },
}
