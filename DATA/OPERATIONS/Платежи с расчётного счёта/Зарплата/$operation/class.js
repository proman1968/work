export default {    label: 'Выплата зарплаты',
    icon: 'carbon:money',
    METADATA: {
        FIELDS: [{ id: 'employee', label: 'Сотрудник', type: 'Link', target: '/DATA/CATALOGS/Сотрудники', required: true }],
        POSTINGS: [{ id: 'main', debit: { account: '/DATA/REGISTER/70', analytics: { employee: 'employee' } } }],
    },
}
