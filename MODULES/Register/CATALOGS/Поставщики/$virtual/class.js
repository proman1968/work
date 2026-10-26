export default {    label: 'Поставщики',
    icon: 'carbon:delivery-truck',
    SOURCE: { registry: '/MODULES/Register/CATALOGS/Субъекты', account: '/MODULES/Register/REGISTER/60', slot: 'counterparty' },
    OVERLAY: [
        { id: 'payment_days', label: 'Отсрочка платежа, дней', type: 'Integer' },
        { id: 'comment', label: 'Комментарий', type: 'Text' },
    ],
}
