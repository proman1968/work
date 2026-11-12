export default {
    label: 'Должности',
    icon: 'carbon:identification',
    METADATA: {
        FIELDS: [
            { id: 'code', label: 'Код должности', type: 'string' },
            { id: 'department', label: 'Подразделение', type: 'string' },
            { id: 'base_salary', label: 'Оклад по штату', type: 'Money' },
        ],
    },
}
