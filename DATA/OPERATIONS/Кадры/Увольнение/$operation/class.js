export default {
    CID: 'op.hr.fire',
    label: 'Увольнение',
    icon: 'carbon:user-admin',
    METADATA: {
        POSTINGS: [
            {
                id: 'main',
                qty: '1',
                debit: { account: 'acc.pool' },
                credit: { account: 'acc.hr.work', analytics: { person: 'person' } },
            },
        ],
    },
}
