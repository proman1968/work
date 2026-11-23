export default {
    label: 'Клиенты',
    icon: 'carbon:customer',
    SOURCE: { registry: '/MODULES/Register/CATALOGS/Субъекты', account: '/MODULES/Register/REGISTER/62', slot: 'counterparty' },
    OVERLAY: [
        { id: 'manager', label: 'Менеджер', type: 'link', target: '/MODULES/Register/CATALOGS/Сотрудники' },
        { id: 'credit_limit', label: 'Кредитный лимит', type: 'money' },
        { id: 'payment_days', label: 'Отсрочка платежа, дней', type: 'integer' },
        { id: 'discount', label: 'Скидка, %', type: 'number' },
    ],
}
