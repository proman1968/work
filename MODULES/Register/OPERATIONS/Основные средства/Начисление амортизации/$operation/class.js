export default {
    label: 'Начисление амортизации ОС',
    icon: 'carbon:chart-line-data',
    METADATA: {
        FIELDS: [
            { id: 'asset', label: 'Объект ОС', type: 'link', target: '/MODULES/Register/CATALOGS/Номенклатура', required: true },
            { id: 'sum', label: 'Сумма амортизации за месяц', type: 'money', required: true },
        ],
        POSTINGS: [
            {
                id: 'depr',
                amount: 'sum',
                debit: { account: '/MODULES/Register/REGISTER/26' },
                credit: { account: '/MODULES/Register/REGISTER/02', analytics: { asset: 'asset' } },
            },
        ],
    },
}
