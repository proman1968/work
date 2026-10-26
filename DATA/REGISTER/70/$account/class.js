export default {    label: '70.00 Расчёты с персоналом',
    icon: 'carbon:wallet',
    METADATA: {
        FIELDS: [
            {
                id: 'employee',
                label: 'Сотрудник',
                type: 'Link',
                target: '/DATA/CATALOGS/Сотрудники',
                analytic: true,
                required: true,
            },
        ],
    },
}
