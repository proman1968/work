export default {    label: 'Отправить в отпуск',
    icon: 'carbon:user',
    METADATA: {
        FIELDS: [{ id: 'until', label: 'Отпуск до', type: 'date' }],
        POSTINGS: [
            {
                id: 'main',
                qty: '1',
                debit: { account: '/MODULES/Register/REGISTER/Кадры/В отпуске', analytics: { person: 'person' } },
                credit: { account: '/MODULES/Register/REGISTER/Кадры/Работают', analytics: { person: 'person' } },
            },
        ],
    },
}
