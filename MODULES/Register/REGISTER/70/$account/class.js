export default {    label: '70 Расчёты с персоналом',
    icon: 'carbon:wallet',
    METADATA: {
        FIELDS: [
            {
                id: 'employee',
                label: 'Сотрудник',
                type: 'Link',
                target: '/MODULES/Register/CATALOGS/Сотрудники',
                analytic: true,
                required: true,
            },
        ],
    },
}
