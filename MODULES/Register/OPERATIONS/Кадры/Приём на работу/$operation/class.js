export default {
    label: 'Приём на работу',
    icon: 'carbon:user-follow',
    METADATA: {
        FIELDS: [
            { id: 'position', label: 'Должность', type: 'link', target: '/MODULES/Register/CATALOGS/Должности' },
            { id: 'salary', label: 'Оклад', type: 'money' },
        ],
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
