export default {
    label: 'Физ. лица',
    icon: 'carbon:user',
    METADATA: {
        FIELDS: [
            { id: 'snils', label: 'СНИЛС', type: 'string' },
            { id: 'position', label: 'Должность', type: 'string' },
            { id: 'passport', label: 'Паспорт', type: '/MODULES/Register/STRUCTS/Паспорт' },
        ],
    },
}
