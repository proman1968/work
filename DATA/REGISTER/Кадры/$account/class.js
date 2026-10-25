export default {
    CID: 'acc.hr',
    label: 'Кадры',
    icon: 'carbon:user-role',
    METADATA: {
        FIELDS: [
            {
                id: 'person',
                label: 'Сотрудник',
                type: 'Link',
                target: 'cat.person',
                analytic: true,
                required: true,
            },
        ],
    },
}
