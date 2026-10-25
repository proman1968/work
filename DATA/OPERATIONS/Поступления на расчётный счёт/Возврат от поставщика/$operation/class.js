export default {
    CID: 'op.receipts.supplier',
    label: 'Возврат от поставщика',
    icon: 'carbon:money',
    METADATA: {
        FIELDS: [
            { id: 'counterparty', label: 'Поставщик', type: 'Link', target: 'cat.suppliers', required: true },
            { id: 'contract', label: 'Договор', type: 'Link', target: 'cat.contracts' },
        ],
        POSTINGS: [{ id: 'main', credit: { account: 'acc.60', analytics: { counterparty: 'counterparty' } } }],
    },
}
