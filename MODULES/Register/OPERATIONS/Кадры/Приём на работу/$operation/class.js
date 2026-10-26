export default {    label: 'Приём на работу',
    icon: 'carbon:user-follow',
    METADATA: {
        FIELDS: [{ id: 'position', label: 'Должность' }, { id: 'salary', label: 'Оклад', type: 'Money' }],
        POSTINGS: [
            {
                id: 'main',
                qty: '1',
                debit: { account: '/MODULES/Register/REGISTER/Кадры/Работают', analytics: { person: 'person' } },
                credit: { account: '/MODULES/Register/REGISTER/Кадровый резерв' },
            },
        ],
    },
}
