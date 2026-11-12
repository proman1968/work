export default {
    label: 'Приходный кассовый ордер',
    icon: 'carbon:money',
    METADATA: {
        FIELDS: [
            { id: 'counterparty', label: 'Принято от', type: 'Link', target: '/MODULES/Register/CATALOGS/Субъекты', required: true },
            { id: 'contract', label: 'Договор', type: 'Link', target: '/MODULES/Register/CATALOGS/Договоры' },
        ],
        POSTINGS: [
            {
                id: 'main',
                amount: 'sum',
                debit: { account: '/MODULES/Register/REGISTER/50' },
                credit: { account: '/MODULES/Register/REGISTER/62', analytics: { counterparty: 'counterparty' } },
            },
        ],
    },
}
