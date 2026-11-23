export default {
    label: 'Задачи и этапы',
    icon: 'carbon:task',
    METADATA: {
        FIELDS: [
            { id: 'process_ref', label: 'Схема процесса (BPMN)', type: 'link', target: '/MODULES/Process/Схемы процессов' },
            { id: 'parent_task', label: 'Родительский этап', type: 'link', target: '/MODULES/Process/Задачи и этапы' },
            { id: 'depends_on', label: 'Предшественник (зависимость)', type: 'link', target: '/MODULES/Process/Задачи и этапы' },
            { id: 'start_at', label: 'Плановое начало', type: 'date' },
            { id: 'due_at', label: 'Плановый срок', type: 'date' },
            { id: 'duration_hours', label: 'Трудоёмкость, ч', type: 'number' },
            { id: 'progress', label: 'Готовность, %', type: 'integer' },
            { id: 'assignee', label: 'Исполнитель / Роль', type: 'string' },
            {
                id: 'status',
                label: 'Статус',
                type: 'enum',
                values: ['К выполнению', 'В работе', 'На проверке', 'Выполнено', 'Отменено'],
            },
            {
                id: 'priority',
                label: 'Приоритет',
                type: 'enum',
                values: ['Низкий', 'Обычный', 'Высокий', 'Критический'],
            },
            { id: 'description', label: 'Описание', type: 'text' },
        ],
    },
}
