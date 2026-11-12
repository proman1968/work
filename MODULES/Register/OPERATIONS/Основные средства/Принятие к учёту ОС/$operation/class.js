export default {
    label: 'Принятие к учёту ОС',
    icon: 'carbon:building-insights-1',
    METADATA: {
        FIELDS: [
            { id: 'asset', label: 'Объект ОС', type: 'Link', target: '/MODULES/Register/CATALOGS/Номенклатура', required: true },
            { id: 'sum', label: 'Первоначальная стоимость', type: 'Money', required: true },
        ],
        POSTINGS: [
            {
                id: 'commission',
                amount: 'sum',
                qty: '1',
                item: 'asset',
                debit: { account: '/MODULES/Register/REGISTER/01', analytics: { asset: 'asset' } },
                credit: { account: '/MODULES/Register/REGISTER/08', analytics: { asset: 'asset' } },
            },
        ],
    },
}
