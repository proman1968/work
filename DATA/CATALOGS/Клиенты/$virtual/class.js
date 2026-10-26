export default {    label: 'Клиенты',
    icon: 'carbon:customer',
    SOURCE: { registry: '/DATA/CATALOGS/Субъекты', account: '/DATA/REGISTER/62', slot: 'counterparty' },
    OVERLAY: [
        { id: 'manager', label: 'Менеджер', type: 'Link', target: '/DATA/CATALOGS/Сотрудники' },
        { id: 'credit_limit', label: 'Кредитный лимит', type: 'Money' },
        { id: 'payment_days', label: 'Отсрочка платежа, дней', type: 'Integer' },
        { id: 'discount', label: 'Скидка, %', type: 'Number' },
    ],
}
