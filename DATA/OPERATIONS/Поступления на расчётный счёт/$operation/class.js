export default {
    CID: 'op.receipts',
    label: 'Поступления на расчётный счёт',
    icon: 'carbon:money',
    METADATA: {
        FIELDS: [
            { id: 'sum', label: 'Сумма', type: 'Money', required: true },
            { id: 'purpose', label: 'Назначение' },
            { id: 'doc_number', label: 'Номер документа' },
        ],
        POSTINGS: [{ id: 'main', amount: 'sum', debit: { account: 'acc.51' } }],
    },
}
