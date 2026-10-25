export default {
    CID: 'op.hr.hire',
    label: 'Приём на работу',
    icon: 'carbon:user-follow',
    METADATA: {
        FIELDS: [{ id: 'position', label: 'Должность' }, { id: 'salary', label: 'Оклад', type: 'Money' }],
        POSTINGS: [
            {
                id: 'main',
                qty: '1',
                debit: { account: 'acc.hr.work', analytics: { person: 'person' } },
                credit: { account: 'acc.pool' },
            },
        ],
    },
}
