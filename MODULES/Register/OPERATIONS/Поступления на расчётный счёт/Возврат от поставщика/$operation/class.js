export default {    label: 'Возврат от поставщика',
    icon: 'carbon:money',
    METADATA: {
        FIELDS: [
            { id: 'counterparty', label: 'Поставщик', type: 'Link', target: '/MODULES/Register/CATALOGS/Поставщики', required: true },
            { id: 'contract', label: 'Договор', type: 'Link', target: '/MODULES/Register/CATALOGS/Договоры' },
        ],
        POSTINGS: [{ id: 'main', credit: { account: '/MODULES/Register/REGISTER/60', analytics: { counterparty: 'counterparty' } } }],
    },
}
