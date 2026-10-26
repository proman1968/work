export default {    label: 'Увольнение',
    icon: 'carbon:user-admin',
    METADATA: {
        POSTINGS: [
            {
                id: 'main',
                qty: '1',
                debit: { account: '/DATA/REGISTER/Кадровый резерв' },
                credit: { account: '/DATA/REGISTER/Кадры/Работают', analytics: { person: 'person' } },
            },
        ],
    },
}
