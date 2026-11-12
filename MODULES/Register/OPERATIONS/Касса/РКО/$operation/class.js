export default {
    label: 'Расходный кассовый ордер',
    icon: 'carbon:money',
    METADATA: {
        FIELDS: [
            { id: 'employee', label: 'Выдать сотруднику (под отчёт)', type: 'Link', target: '/MODULES/Register/CATALOGS/Сотрудники', required: true },
        ],
        POSTINGS: [
            {
                id: 'main',
                amount: 'sum',
                debit: { account: '/MODULES/Register/REGISTER/71', analytics: { employee: 'employee' } },
                credit: { account: '/MODULES/Register/REGISTER/50' },
            },
        ],
    },
}
