export default {
    label: 'Субъекты',
    icon: 'carbon:user-multiple',
    METADATA: {
        FIELDS: [
            { id: 'phone', label: 'Телефон', type: 'string' },
            { id: 'email', label: 'E-mail', type: 'string' },
            { id: 'legal_address', label: 'Юридический адрес / Адрес регистрации', type: '/MODULES/Register/STRUCTS/Адрес' },
            { id: 'actual_address', label: 'Фактический адрес', type: '/MODULES/Register/STRUCTS/Адрес' },
            { id: 'comment', label: 'Комментарий', type: 'text' },
        ],
    },
}
