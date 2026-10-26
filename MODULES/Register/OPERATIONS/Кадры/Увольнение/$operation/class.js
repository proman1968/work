export default {    label: 'Увольнение',
    icon: 'carbon:user-admin',
    METADATA: {
        POSTINGS: [
            {
                id: 'main',
                qty: '1',
                debit: { account: '/MODULES/Register/REGISTER/Кадровый резерв' },
                credit: { account: '/MODULES/Register/REGISTER/Кадры/Работают', analytics: { person: 'person' } },
            },
        ],
    },
}
