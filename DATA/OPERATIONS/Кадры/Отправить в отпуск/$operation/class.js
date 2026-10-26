export default {    label: 'Отправить в отпуск',
    icon: 'carbon:user',
    METADATA: {
        FIELDS: [{ id: 'until', label: 'Отпуск до', type: 'Date' }],
        POSTINGS: [
            {
                id: 'main',
                qty: '1',
                debit: { account: '/DATA/REGISTER/Кадры/В отпуске', analytics: { person: 'person' } },
                credit: { account: '/DATA/REGISTER/Кадры/Работают', analytics: { person: 'person' } },
            },
        ],
    },
}
