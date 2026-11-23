export default {
    label: 'Схемы процессов (BPMN)',
    icon: 'carbon:flow',
    METADATA: {
        FIELDS: [
            { id: 'code', label: 'Код процесса', type: 'string' },
            { id: 'owner_role', label: 'Ответственная роль / отдел', type: 'string' },
            {
                id: 'status',
                label: 'Статус',
                type: 'enum',
                values: ['Черновик', 'Действует', 'Архив'],
            },
            { id: 'bpmn_xml', label: 'Схема BPMN (JSON / XML)', type: 'text' },
            { id: 'description', label: 'Описание регламента', type: 'text' },
        ],
    },
}
