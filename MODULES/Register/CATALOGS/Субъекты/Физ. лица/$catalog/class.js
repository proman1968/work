export default {
    label: 'Физ. лица',
    icon: 'carbon:user',
    METADATA: {
        FIELDS: [
            { id: 'fio', label: 'ФИО', type: '/MODULES/Register/STRUCTS/ФИО' },
            { id: 'snils', label: 'СНИЛС', type: 'string' },
            { id: 'inn', label: 'ИНН', type: 'string' },
            { id: 'passport', label: 'Паспорт', type: '/MODULES/Register/STRUCTS/Паспорт' },
        ],
    },
}
