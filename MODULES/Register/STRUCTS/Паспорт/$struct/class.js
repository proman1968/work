export default {
    label: 'Паспорт',
    icon: 'carbon:identification',
    METADATA: {
        FIELDS: [
            { id: 'series', label: 'Серия', type: 'string' },
            { id: 'number', label: 'Номер', type: 'string' },
            { id: 'issued_date', label: 'Дата выдачи', type: 'date' },
            { id: 'issued_unit_code', label: 'Код подразделения', type: 'string' },
            { id: 'issued_unit', label: 'Подразделение МВД (кем выдан)', type: 'link', target: '/MODULES/KLADR/Подразделения МВД' },
            { id: 'address', label: 'Адрес регистрации', type: '/MODULES/Register/STRUCTS/Адрес' },
        ],
    },
}
