export default {
    CID: 'cat.org',
    label: 'Юр. лица',
    icon: 'carbon:building',
    METADATA: {
        FIELDS: [
            { id: 'inn', label: 'ИНН', required: true },
            { id: 'kpp', label: 'КПП' },
            { id: 'ogrn', label: 'ОГРН' },
            { id: 'bank', label: 'Банк' },
            { id: 'bik', label: 'БИК' },
            { id: 'account', label: 'Р/с' },
            { id: 'corr', label: 'К/с' },
        ],
    },
}
