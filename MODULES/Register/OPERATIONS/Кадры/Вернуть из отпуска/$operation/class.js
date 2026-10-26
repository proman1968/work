export default {    label: 'Вернуть из отпуска',
    icon: 'carbon:user',
    METADATA: {
        POSTINGS: [
            {
                id: 'main',
                qty: '1',
                debit: { account: '/MODULES/Register/REGISTER/Кадры/Работают', analytics: { person: 'person' } },
                credit: { account: '/MODULES/Register/REGISTER/Кадры/В отпуске', analytics: { person: 'person' } },
            },
        ],
    },
}
