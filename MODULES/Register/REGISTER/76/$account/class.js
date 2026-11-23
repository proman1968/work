export default {
    label: '76 Расчёты с разными дебиторами и кредиторами',
    icon: 'carbon:wallet',
    METADATA: {
        FIELDS: [
            { id: 'counterparty', label: 'Контрагент', type: 'link', target: '/MODULES/Register/CATALOGS/Субъекты', analytic: true },
        ],
    },
}
