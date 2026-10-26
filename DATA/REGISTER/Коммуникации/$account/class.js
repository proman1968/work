export default {    label: 'Коммуникации',
    icon: 'carbon:email',
    METADATA: {
        FIELDS: [
            {
                id: 'counterparty',
                label: 'Контрагент',
                type: 'Link',
                target: '/DATA/CATALOGS/Субъекты',
                analytic: true,
                required: true,
            },
        ],
    },
}
