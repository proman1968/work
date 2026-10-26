export default {    label: 'От покупателя',
    icon: 'carbon:money',
    METADATA: {
        FIELDS: [
            { id: 'counterparty', label: 'Покупатель', type: 'Link', target: '/DATA/CATALOGS/Клиенты', required: true },
            { id: 'contract', label: 'Договор', type: 'Link', target: '/DATA/CATALOGS/Договоры' },
        ],
        POSTINGS: [{ id: 'main', credit: { account: '/DATA/REGISTER/62', analytics: { counterparty: 'counterparty' } } }],
    },
}
