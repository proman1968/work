export default {
    label: 'Подразделения МВД',
    icon: 'carbon:police',
    METADATA: {
        FIELDS: [
            { id: 'name', label: 'Наименование (код + орган)', type: 'string', required: true },
            { id: 'code', label: 'Код подразделения (XXX-XXX)', type: 'string', required: true },
            { id: 'unit_name', label: 'Наименование подразделения', type: 'text', required: true },
            { id: 'region_code', label: 'Код региона', type: 'string' },
            { id: 'active', label: 'Действующее', type: 'boolean' },
        ],
    },
}
