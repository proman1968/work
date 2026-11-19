export default {
    icon: 'carbon:rocket',
    label: 'Проект',
    METADATA: {
        STATIC: [
            { id: 'code', label: 'Код проекта', type: 'string' },
            { id: 'customer', label: 'Заказчик / Инициатор', type: 'string' },
            { id: 'start_date', label: 'Дата начала', type: 'date' },
            { id: 'end_date', label: 'Дата окончания', type: 'date' },
            { id: 'status', label: 'Статус', type: 'string' },
            { id: 'budget', label: 'Бюджет', type: 'number' },
            { id: 'description', label: 'Описание', type: 'string' },
        ],
    },
}
