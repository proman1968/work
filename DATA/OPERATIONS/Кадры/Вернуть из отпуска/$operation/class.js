export default {
    CID: 'op.hr.back',
    label: 'Вернуть из отпуска',
    icon: 'carbon:user',
    METADATA: {
        POSTINGS: [
            {
                id: 'main',
                qty: '1',
                debit: { account: 'acc.hr.work', analytics: { person: 'person' } },
                credit: { account: 'acc.hr.vacation', analytics: { person: 'person' } },
            },
        ],
    },
}
