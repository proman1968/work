export default { label: 'Расчёты с покупателями', icon: 'carbon:wallet', METADATA: { FIELDS: [
    { id: 'counterparty', type: 'Link', catalog: '/DATA/CATALOGS/КОНТРАГЕНТЫ', analytic: true, label: 'Контрагент' } ],
    INDEXES: [{ id: 'turnover', kind: 'turnover', by: ['counterparty'], measures: { debit: 'sum', credit: 'sum' } }] } }