export default {
    label: 'ИП',
    icon: 'carbon:user-avatar',
    METADATA: {
        FIELDS: [
            { id: 'fio', label: 'ФИО предпринимателя', type: '/MODULES/Register/STRUCTS/ФИО' },
            { id: 'inn', label: 'ИНН', type: 'string', required: true },
            { id: 'ogrnip', label: 'ОГРНИП', type: 'string' },
            { id: 'bank_accounts', label: 'Банковские счета', type: '/MODULES/Register/STRUCTS/Банковский счёт', table: true },
        ],
    },
}
