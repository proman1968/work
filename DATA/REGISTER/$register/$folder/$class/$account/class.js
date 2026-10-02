export default {
    icon: 'carbon:data-base',
    label: 'Счёт',
    METADATA: {
        STATIC: [
            { id: 'label', label: 'Название', type: 'string' },
            { id: 'icon', label: 'Иконка', type: 'string' },
        ],
        FIELDS: [
            { id: 'source', label: 'Операция', type: 'String', placeholder: '/DATA/OPERATIONS/…/<id>' },
            { id: 'entry', label: 'Проводка', type: 'String' },
            { id: 'rule', label: 'Правило', type: 'String' },
            { id: 'corr_account', label: 'Корр. счёт', type: 'String', placeholder: '/DATA/REGISTER/…' },
            { id: 'debit', label: 'Дебет', type: 'Number' },
            { id: 'credit', label: 'Кредит', type: 'Number' },
            { id: 'qty_in', label: 'Кол-во приход', type: 'Number' },
            { id: 'qty_out', label: 'Кол-во расход', type: 'Number' },
            { id: 'storno', label: 'Сторно', type: 'Boolean' },
        ],
    },
}
