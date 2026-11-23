export default {
    label: 'Регионы РФ',
    icon: 'carbon:map-boundary',
    METADATA: {
        FIELDS: [
            { id: 'name', label: 'Наименование', type: 'string', required: true },
            { id: 'code', label: 'Код субъекта (01–92)', type: 'string', required: true },
            { id: 'kladr_code', label: 'Код КЛАДР', type: 'string' },
            { id: 'okato', label: 'ОКАТО', type: 'string' },
            { id: 'oktmo', label: 'ОКТМО', type: 'string' },
            { id: 'fias_id', label: 'ФИАС GUID', type: 'string' },
        ],
    },
}
