export default {
    label: 'ИП',
    icon: 'carbon:user-avatar',
    METADATA: {
        FIELDS: [
            { id: 'inn', label: 'ИНН', required: true },
            { id: 'ogrnip', label: 'ОГРНИП' },
            { id: 'bank', label: 'Банк' },
            { id: 'bik', label: 'БИК' },
            { id: 'account', label: 'Р/с' },
            { id: 'corr', label: 'К/с' },
        ],
    },
}
