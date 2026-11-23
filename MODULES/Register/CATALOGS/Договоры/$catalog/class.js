export default {
    label: 'Договоры',
    icon: 'carbon:document',
    METADATA: {
        FIELDS: [
            { id: 'counterparty', label: 'Контрагент', type: 'link', target: '/MODULES/Register/CATALOGS/Субъекты', required: true },
            {
                id: 'kind',
                label: 'Вид',
                type: 'enum',
                values: ['Поставка', 'Покупка', 'Перевозка', 'Услуги', 'Аренда', 'Подряд'],
                required: true,
            },
            { id: 'number', label: 'Номер договора', type: 'string' },
            { id: 'date', label: 'Дата', type: 'date', required: true },
            { id: 'valid_to', label: 'Действует до', type: 'date' },
            { id: 'payment_days', label: 'Отсрочка платежа, дней', type: 'integer' },
            { id: 'amount', label: 'Сумма', type: 'money' },
        ],
    },
}
