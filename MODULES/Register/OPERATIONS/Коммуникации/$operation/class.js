export default {    label: 'Коммуникации',
    icon: 'carbon:chat',
    METADATA: {
        FIELDS: [
            { id: 'counterparty', label: 'Контрагент', type: 'Link', target: '/MODULES/Register/CATALOGS/Субъекты', required: true },
            { id: 'subject', label: 'Тема' },
        ],
    },
}
