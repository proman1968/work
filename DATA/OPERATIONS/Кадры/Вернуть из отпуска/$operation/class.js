export default {    label: 'Вернуть из отпуска',
    icon: 'carbon:user',
    METADATA: {
        POSTINGS: [
            {
                id: 'main',
                qty: '1',
                debit: { account: '/DATA/REGISTER/Кадры/Работают', analytics: { person: 'person' } },
                credit: { account: '/DATA/REGISTER/Кадры/В отпуске', analytics: { person: 'person' } },
            },
        ],
    },
}
