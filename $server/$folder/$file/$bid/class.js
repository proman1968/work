export default {
    icon: 'carbon:request-quote',
    label: 'Заявка',
    FIELDS: [
        { id: 'status', type: 'string', options: ['draft', 'submitted'] },
        { id: 'role', type: 'string' },
        { id: 'buyer', type: 'string' },
        { id: 'created', type: 'number' },
        { id: 'target', type: 'string' },
        { id: 'product' },
        { id: 'input' },
    ],
}
