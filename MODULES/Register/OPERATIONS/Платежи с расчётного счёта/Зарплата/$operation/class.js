export default {    label: 'Выплата зарплаты',
    icon: 'carbon:money',
    METADATA: {
        FIELDS: [{ id: 'employee', label: 'Сотрудник', type: 'Link', target: '/MODULES/Register/CATALOGS/Сотрудники', required: true }],
        POSTINGS: [{ id: 'main', debit: { account: '/MODULES/Register/REGISTER/70', analytics: { employee: 'employee' } } }],
    },
}
