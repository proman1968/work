export default {    label: 'Коммуникации',
    icon: 'carbon:email',
    METADATA: {
        FIELDS: [
            {
                id: 'counterparty',
                label: 'Контрагент',
                type: 'Link',
                target: '/MODULES/Register/CATALOGS/Субъекты',
                analytic: true,
                required: true,
            },
        ],
    },
}
