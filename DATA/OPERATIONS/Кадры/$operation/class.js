export default {
    CID: 'op.hr',
    label: 'Кадры',
    icon: 'carbon:user-role',
    METADATA: {
        FIELDS: [
            { id: 'person', label: 'Сотрудник', type: 'Link', target: 'cat.person', required: true },
            { id: 'order_number', label: 'Номер приказа' },
        ],
    },
}
