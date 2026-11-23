export default {
    label: 'Начисление зарплаты',
    icon: 'carbon:calculator',
    METADATA: {
        FIELDS: [
            { id: 'period', label: 'За месяц', type: 'date' },
            {
                id: 'staff',
                label: 'Сотрудники',
                table: true,
                required: true,
                FIELDS: [
                    {
                        id: 'employee',
                        label: 'Сотрудник',
                        type: 'link',
                        target: '/MODULES/Register/CATALOGS/Сотрудники',
                        required: true,
                    },
                    { id: 'sum', label: 'Начислено', type: 'money', required: true },
                ],
            },
        ],
        POSTINGS: [
            {
                id: 'accrual',
                each: 'staff',
                amount: 'row.sum',
                debit: { account: '/MODULES/Register/REGISTER/26' },
                credit: { account: '/MODULES/Register/REGISTER/70', analytics: { employee: 'row.employee' } },
            },
            {
                id: 'contributions',
                each: 'staff',
                amount: "round(row.sum * norm('Ставка страховых взносов'), 2)",
                debit: { account: '/MODULES/Register/REGISTER/26' },
                credit: { account: '/MODULES/Register/REGISTER/69' },
            },
            {
                id: 'ndfl',
                each: 'staff',
                amount: "round(row.sum * norm('Ставка НДФЛ'), 2)",
                debit: { account: '/MODULES/Register/REGISTER/70', analytics: { employee: 'row.employee' } },
                credit: { account: '/MODULES/Register/REGISTER/68/01' },
            },
        ],
    },
}
