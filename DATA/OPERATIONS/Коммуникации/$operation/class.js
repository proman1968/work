export default {    label: 'Коммуникации',
    icon: 'carbon:chat',
    METADATA: {
        FIELDS: [
            { id: 'counterparty', label: 'Контрагент', type: 'Link', target: '/DATA/CATALOGS/Субъекты', required: true },
            { id: 'subject', label: 'Тема' },
        ],
    },
}
