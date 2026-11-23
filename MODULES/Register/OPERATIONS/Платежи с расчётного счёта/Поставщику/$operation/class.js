export default {
    label: 'Поставщику',
    icon: 'carbon:money',
    METADATA: {
        FIELDS: [
            { id: 'counterparty', label: 'Поставщик', type: 'link', target: '/MODULES/Register/CATALOGS/Поставщики', required: true },
            { id: 'contract', label: 'Договор', type: 'link', target: '/MODULES/Register/CATALOGS/Договоры' },
        ],
        POSTINGS: [{ id: 'main', debit: { account: '/MODULES/Register/REGISTER/60', analytics: { counterparty: 'counterparty', contract: 'contract' } } }],
    },
}
