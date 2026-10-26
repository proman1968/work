export default {    label: 'От покупателя',
    icon: 'carbon:money',
    METADATA: {
        FIELDS: [
            { id: 'counterparty', label: 'Покупатель', type: 'Link', target: '/MODULES/Register/CATALOGS/Клиенты', required: true },
            { id: 'contract', label: 'Договор', type: 'Link', target: '/MODULES/Register/CATALOGS/Договоры' },
        ],
        POSTINGS: [{ id: 'main', credit: { account: '/MODULES/Register/REGISTER/62', analytics: { counterparty: 'counterparty' } } }],
    },
}
