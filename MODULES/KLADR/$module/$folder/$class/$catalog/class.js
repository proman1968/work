export default {
    label: 'Справочник КЛАДР',
    icon: 'carbon:catalog',
    $public: {
        form: 'objects',
    },
    METADATA: {
        FIELDS: [
            { id: 'name', label: 'Наименование', type: 'string', required: true },
        ],
    },
}
