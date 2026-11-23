export default {
    label: 'Юр. лица',
    icon: 'carbon:building',
    METADATA: {
        FIELDS: [
            { id: 'full_name', label: 'Полное наименование', type: 'string' },
            { id: 'inn', label: 'ИНН', type: 'string', required: true },
            { id: 'kpp', label: 'КПП', type: 'string' },
            { id: 'ogrn', label: 'ОГРН', type: 'string' },
            { id: 'okpo', label: 'ОКПО', type: 'string' },
            { id: 'ceo', label: 'Руководитель', type: '/MODULES/Register/STRUCTS/ФИО' },
            { id: 'bank_accounts', label: 'Банковские счета', type: '/MODULES/Register/STRUCTS/Банковский счёт', table: true },
        ],
    },
}
