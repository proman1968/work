export default {
    CID: 'cat.contracts',
    label: 'Договоры',
    icon: 'carbon:document',
    METADATA: {
        FIELDS: [
            { id: 'counterparty', label: 'Контрагент', type: 'Link', target: 'cat.subjects', required: true },
            {
                id: 'kind',
                label: 'Вид',
                type: 'Enum',
                values: ['Поставка', 'Покупка', 'Перевозка'],
                required: true,
            },
            { id: 'date', label: 'Дата', type: 'Date', required: true },
            { id: 'valid_to', label: 'Действует до', type: 'Date' },
            { id: 'payment_days', label: 'Отсрочка платежа, дней', type: 'Integer' },
            { id: 'amount', label: 'Сумма', type: 'Money' },
        ],
    },
}
