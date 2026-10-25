export default {
    CID: 'cat.suppliers',
    label: 'Поставщики',
    icon: 'carbon:delivery-truck',
    SOURCE: { registry: 'cat.subjects', account: 'acc.60', slot: 'counterparty' },
    OVERLAY: [
        { id: 'payment_days', label: 'Отсрочка платежа, дней', type: 'Integer' },
        { id: 'comment', label: 'Комментарий', type: 'Text' },
    ],
}
