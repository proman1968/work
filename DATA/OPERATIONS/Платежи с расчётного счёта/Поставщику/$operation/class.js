export default {    label: 'Поставщику',
    icon: 'carbon:money',
    METADATA: {
        FIELDS: [
            { id: 'counterparty', label: 'Поставщик', type: 'Link', target: '/DATA/CATALOGS/Поставщики', required: true },
            { id: 'contract', label: 'Договор', type: 'Link', target: '/DATA/CATALOGS/Договоры' },
        ],
        POSTINGS: [{ id: 'main', debit: { account: '/DATA/REGISTER/60', analytics: { counterparty: 'counterparty' } } }],
    },
}
