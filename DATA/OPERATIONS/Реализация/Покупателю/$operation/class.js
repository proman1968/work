export default { label: 'Покупателю', '#security': { USERS: ['CA4E097FF6C1D387'] },
    METADATA: { POSTINGS: [{ id: 'main', amount: 'sum',
        debit: { account: '/DATA/REGISTER/62', analytics: { counterparty: 'client' } },
        credit: { account: '/DATA/REGISTER/90' } }] } }