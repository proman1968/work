export default {
    CID: 'cat.clients',
    label: 'Клиенты',
    icon: 'carbon:customer',
    SOURCE: { registry: 'cat.subjects', account: 'acc.62', slot: 'counterparty' },
    OVERLAY: [
        { id: 'manager', label: 'Менеджер', type: 'Link', target: 'cat.employees' },
        { id: 'credit_limit', label: 'Кредитный лимит', type: 'Money' },
        { id: 'payment_days', label: 'Отсрочка платежа, дней', type: 'Integer' },
        { id: 'discount', label: 'Скидка, %', type: 'Number' },
    ],
}
