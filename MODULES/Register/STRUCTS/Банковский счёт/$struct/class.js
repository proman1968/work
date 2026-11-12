export default {
    label: 'Банковский счёт',
    icon: 'carbon:bank-note',
    METADATA: {
        FIELDS: [
            { id: 'bank', label: 'Банк', type: 'string', required: true },
            { id: 'bik', label: 'БИК', type: 'string', required: true },
            { id: 'account', label: 'Расчётный счёт', type: 'string', required: true },
            { id: 'corr', label: 'Корр. счёт', type: 'string' },
        ],
    },
}
