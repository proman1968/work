export default {
    label: '73 Расчёты с персоналом по прочим операциям',
    icon: 'carbon:wallet',
    METADATA: {
        FIELDS: [
            { id: 'employee', label: 'Сотрудник', type: 'Link', target: '/MODULES/Register/CATALOGS/Сотрудники', analytic: true },
        ],
    },
}
