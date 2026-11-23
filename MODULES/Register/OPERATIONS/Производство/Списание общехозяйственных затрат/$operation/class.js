export default {
    label: 'Списание общехозяйственных затрат',
    icon: 'carbon:document-subtract',
    METADATA: {
        FIELDS: [
            { id: 'supplier', label: 'Поставщик услуг / подрядчик', type: 'link', target: '/MODULES/Register/CATALOGS/Поставщики', required: true },
            { id: 'contract', label: 'Договор', type: 'link', target: '/MODULES/Register/CATALOGS/Договоры' },
            { id: 'sum', label: 'Сумма без НДС', type: 'money', required: true },
            { id: 'vat_sum', label: 'НДС', type: 'money' },
            { id: 'purpose', label: 'Содержание услуги / расхода' },
        ],
        POSTINGS: [
            {
                id: 'expense',
                amount: 'sum',
                debit: { account: '/MODULES/Register/REGISTER/26' },
                credit: { account: '/MODULES/Register/REGISTER/60', analytics: { counterparty: 'supplier', contract: 'contract' } },
            },
            {
                id: 'vat',
                when: 'vat_sum > 0',
                amount: 'vat_sum',
                debit: { account: '/MODULES/Register/REGISTER/19' },
                credit: { account: '/MODULES/Register/REGISTER/60', analytics: { counterparty: 'supplier', contract: 'contract' } },
            },
        ],
    },
}
