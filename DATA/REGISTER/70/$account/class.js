export default {
    CID: 'acc.70',
    label: '70.00 Расчёты с персоналом',
    icon: 'carbon:wallet',
    METADATA: {
        FIELDS: [
            {
                id: 'employee',
                label: 'Сотрудник',
                type: 'Link',
                target: 'cat.employees',
                analytic: true,
                required: true,
            },
        ],
    },
}
