export default { label: 'От покупателя', '#security': { USER: ['CA4E097FF6C1D387'] },
    METADATA: { POSTINGS: [{ id: 'main', amount: 'sum',
        debit: { account: '/DATA/REGISTER/51' },
        credit: { account: '/DATA/REGISTER/62', analytics: { counterparty: 'client' } } }] } }