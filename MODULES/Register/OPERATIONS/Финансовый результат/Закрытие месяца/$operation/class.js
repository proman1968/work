export default {
    label: 'Закрытие месяца',
    icon: 'carbon:calculator-check',
    METADATA: {
        FIELDS: [
            { id: 'sum', label: 'Финансовый результат (прибыль)', type: 'Money', required: true },
            { id: 'comment', label: 'Комментарий к закрытию месяца' },
        ],
        POSTINGS: [
            {
                id: 'close_profit',
                amount: 'sum',
                debit: { account: '/MODULES/Register/REGISTER/90/09' },
                credit: { account: '/MODULES/Register/REGISTER/99' },
            },
        ],
    },
}
