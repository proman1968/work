export default { label: 'Письмо', '#security': { USERS: ['CA4E097FF6C1D387'] },
    METADATA: { FIELDS: [{ id: 'name', label: 'Название' }, { id: 'time', type: 'timestamp' }, { id: 'client', type: 'Link', catalog: '/CATALOGS/КОНТРАГЕНТЫ', required: true, label: 'Клиент' },
        { id: 'qty', type: 'Number', label: 'Количество' }, { id: 'sum', type: 'Number', label: 'Сумма' }],
        POSTINGS: [{ id: 'main', amount: 'sum', quantity: 'qty',
        debit: { account: '/REGISTER/62', analytics: { counterparty: 'client' } }, credit: { account: '/REGISTER/ПИСЬМА' } }] } }