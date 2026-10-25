export default {
    CID: 'op.hr.vacation',
    label: 'Отправить в отпуск',
    icon: 'carbon:user',
    METADATA: {
        FIELDS: [{ id: 'until', label: 'Отпуск до', type: 'Date' }],
        POSTINGS: [
            {
                id: 'main',
                qty: '1',
                debit: { account: 'acc.hr.vacation', analytics: { person: 'person' } },
                credit: { account: 'acc.hr.work', analytics: { person: 'person' } },
            },
        ],
    },
}
