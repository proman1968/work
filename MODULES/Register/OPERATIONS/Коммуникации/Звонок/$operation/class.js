export default {    label: 'Звонок',
    icon: 'carbon:phone',
    AUTO_REGISTER: true,
    METADATA: {
        FIELDS: [
            {
                id: 'direction',
                label: 'Направление',
                type: 'Enum',
                values: ['Входящий', 'Исходящий'],
                required: true,
            },
            { id: 'minutes', label: 'Длительность, мин', type: 'Number', required: true },
        ],
        POSTINGS: [
            {
                id: 'main',
                qty: 'minutes',
                amount: "round(minutes * norm('Стоимость минуты звонка'), 2)",
                debit: { account: '/MODULES/Register/REGISTER/Коммуникации', analytics: { counterparty: 'counterparty' } },
                credit: { account: '/MODULES/Register/REGISTER/Технический' },
            },
        ],
    },
}
