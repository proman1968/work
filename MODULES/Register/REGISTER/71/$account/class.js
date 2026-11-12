export default {
    label: '71 Расчёты с подотчётными лицами',
    icon: 'carbon:wallet',
    METADATA: {
        FIELDS: [
            { id: 'employee', label: 'Сотрудник', type: 'Link', target: '/MODULES/Register/CATALOGS/Сотрудники', analytic: true },
        ],
    },
}
