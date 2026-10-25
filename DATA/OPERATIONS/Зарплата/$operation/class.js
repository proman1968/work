export default {
    CID: 'op.payroll',
    label: 'Начисление зарплаты',
    icon: 'carbon:calculator',
    METADATA: {
        FIELDS: [
            { id: 'period', label: 'За месяц', type: 'Date' },
            {
                id: 'staff',
                label: 'Сотрудники',
                type: 'Table',
                required: true,
                FIELDS: [
                    {
                        id: 'employee',
                        label: 'Сотрудник',
                        type: 'Link',
                        target: 'cat.employees',
                        required: true,
                    },
                    { id: 'sum', label: 'Начислено', type: 'Money', required: true },
                ],
            },
        ],
        POSTINGS: [
            {
                id: 'accrual',
                each: 'staff',
                amount: 'row.sum',
                debit: { account: 'acc.26' },
                credit: { account: 'acc.70', analytics: { employee: 'row.employee' } },
            },
            {
                id: 'contributions',
                each: 'staff',
                amount: "round(row.sum * norm('Ставка страховых взносов'), 2)",
                debit: { account: 'acc.26' },
                credit: { account: 'acc.69' },
            },
            {
                id: 'ndfl',
                each: 'staff',
                amount: "round(row.sum * norm('Ставка НДФЛ'), 2)",
                debit: { account: 'acc.70', analytics: { employee: 'row.employee' } },
                credit: { account: 'acc.68.01' },
            },
        ],
    },
}
