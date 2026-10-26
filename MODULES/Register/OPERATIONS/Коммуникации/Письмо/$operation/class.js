export default {    label: 'Письмо',
    icon: 'carbon:email',
    AUTO_REGISTER: true,
    METADATA: {
        FIELDS: [
            {
                id: 'direction',
                label: 'Направление',
                type: 'Enum',
                values: ['Входящее', 'Исходящее'],
                required: true,
            },
        ],
        POSTINGS: [
            {
                id: 'main',
                qty: '1',
                amount: "norm('Стоимость письма')",
                debit: { account: '/MODULES/Register/REGISTER/Коммуникации', analytics: { counterparty: 'counterparty' } },
                credit: { account: '/MODULES/Register/REGISTER/Технический' },
            },
        ],
    },
}
