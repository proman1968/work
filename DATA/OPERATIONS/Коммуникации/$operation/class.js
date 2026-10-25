export default {
    CID: 'op.comm',
    label: 'Коммуникации',
    icon: 'carbon:chat',
    METADATA: {
        FIELDS: [
            { id: 'counterparty', label: 'Контрагент', type: 'Link', target: 'cat.subjects', required: true },
            { id: 'subject', label: 'Тема' },
        ],
    },
}
