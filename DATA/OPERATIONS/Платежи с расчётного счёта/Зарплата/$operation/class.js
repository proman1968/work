export default {
    CID: 'op.pay.salary',
    label: 'Выплата зарплаты',
    icon: 'carbon:money',
    METADATA: {
        FIELDS: [{ id: 'employee', label: 'Сотрудник', type: 'Link', target: 'cat.employees', required: true }],
        POSTINGS: [{ id: 'main', debit: { account: 'acc.70', analytics: { employee: 'employee' } } }],
    },
}
