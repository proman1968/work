export default {
    CID: 'op.pay.supplier',
    label: 'Поставщику',
    icon: 'carbon:money',
    METADATA: {
        FIELDS: [
            { id: 'counterparty', label: 'Поставщик', type: 'Link', target: 'cat.suppliers', required: true },
            { id: 'contract', label: 'Договор', type: 'Link', target: 'cat.contracts' },
        ],
        POSTINGS: [{ id: 'main', debit: { account: 'acc.60', analytics: { counterparty: 'counterparty' } } }],
    },
}
