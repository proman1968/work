export default {    label: 'Платежи с расчётного счёта',
    icon: 'carbon:money',
    METADATA: {
        FIELDS: [
            { id: 'sum', label: 'Сумма', type: 'Money', required: true },
            { id: 'purpose', label: 'Назначение' },
            { id: 'doc_number', label: 'Номер документа' },
        ],
        POSTINGS: [{ id: 'main', amount: 'sum', credit: { account: '/DATA/REGISTER/51' } }],
    },
}
