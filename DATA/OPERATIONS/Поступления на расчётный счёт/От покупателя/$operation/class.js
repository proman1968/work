export default {
    CID: 'op.receipts.customer',
    label: 'От покупателя',
    icon: 'carbon:money',
    METADATA: {
        FIELDS: [
            { id: 'counterparty', label: 'Покупатель', type: 'Link', target: 'cat.clients', required: true },
            { id: 'contract', label: 'Договор', type: 'Link', target: 'cat.contracts' },
        ],
        POSTINGS: [{ id: 'main', credit: { account: 'acc.62', analytics: { counterparty: 'counterparty' } } }],
    },
}
