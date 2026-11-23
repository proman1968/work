export default {
    label: 'ФИО',
    icon: 'carbon:user-identification',
    FORMAT: {
        field: 'format',
        values: ['Именительный', 'Родительный', 'Дательный', 'Винительный', 'Творительный', 'Предложный', 'Инициалы', 'И. О. Фамилия'],
    },
    METADATA: {
        FIELDS: [
            { id: 'last_name', label: 'Фамилия', type: 'string', required: true },
            { id: 'first_name', label: 'Имя', type: 'string', required: true },
            { id: 'middle_name', label: 'Отчество', type: 'string' },
            { id: 'gender', label: 'Пол', type: 'enum', values: ['auto', 'm', 'f'] },
        ],
    },
}
