export default {    label: 'Начисление зарплаты',
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
                        target: '/DATA/CATALOGS/Сотрудники',
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
                debit: { account: '/DATA/REGISTER/26' },
                credit: { account: '/DATA/REGISTER/70', analytics: { employee: 'row.employee' } },
            },
            {
                id: 'contributions',
                each: 'staff',
                amount: "round(row.sum * norm('Ставка страховых взносов'), 2)",
                debit: { account: '/DATA/REGISTER/26' },
                credit: { account: '/DATA/REGISTER/69' },
            },
            {
                id: 'ndfl',
                each: 'staff',
                amount: "round(row.sum * norm('Ставка НДФЛ'), 2)",
                debit: { account: '/DATA/REGISTER/70', analytics: { employee: 'row.employee' } },
                credit: { account: '/DATA/REGISTER/68/01' },
            },
        ],
    },
}
