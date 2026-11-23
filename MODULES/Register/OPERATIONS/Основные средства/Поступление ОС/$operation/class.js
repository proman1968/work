export default {
    label: 'Поступление ОС',
    icon: 'carbon:building-insights-1',
    METADATA: {
        FIELDS: [
            { id: 'supplier', label: 'Поставщик', type: 'link', target: '/MODULES/Register/CATALOGS/Поставщики', required: true },
            { id: 'contract', label: 'Договор', type: 'link', target: '/MODULES/Register/CATALOGS/Договоры' },
            { id: 'asset', label: 'Объект ОС', type: 'link', target: '/MODULES/Register/CATALOGS/Номенклатура', required: true },
            { id: 'sum', label: 'Стоимость без НДС', type: 'money', required: true },
            { id: 'vat_sum', label: 'НДС', type: 'money' },
        ],
        POSTINGS: [
            {
                id: 'capex',
                amount: 'sum',
                qty: '1',
                item: 'asset',
                debit: { account: '/MODULES/Register/REGISTER/08', analytics: { asset: 'asset' } },
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
