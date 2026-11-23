export default {    label: 'Звонок',
    icon: 'carbon:phone',
    AUTO_REGISTER: true,
    METADATA: {
        FIELDS: [
            {
                id: 'direction',
                label: 'Направление',
                type: 'enum',
                values: ['Входящий', 'Исходящий'],
                required: true,
            },
            { id: 'minutes', label: 'Длительность, мин', type: 'number', required: true },
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
