export default {
    label: 'Авансовый отчёт',
    icon: 'carbon:receipt',
    METADATA: {
        FIELDS: [
            { id: 'employee', label: 'Подотчётное лицо', type: 'Link', target: '/MODULES/Register/CATALOGS/Сотрудники', required: true },
        ],
        POSTINGS: [
            {
                id: 'main',
                amount: 'sum',
                debit: { account: '/MODULES/Register/REGISTER/26' },
                credit: { account: '/MODULES/Register/REGISTER/71', analytics: { employee: 'employee' } },
            },
        ],
    },
}
