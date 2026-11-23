export default {
    label: 'Кассовые операции',
    icon: 'carbon:money',
    METADATA: {
        FIELDS: [
            { id: 'sum', label: 'Сумма', type: 'money', required: true },
            { id: 'purpose', label: 'Основание / назначение' },
        ],
    },
}
