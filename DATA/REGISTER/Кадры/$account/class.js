export default {    label: 'Кадры',
    icon: 'carbon:user-role',
    METADATA: {
        FIELDS: [
            {
                id: 'person',
                label: 'Сотрудник',
                type: 'Link',
                target: '/DATA/CATALOGS/Субъекты/Физ. лица',
                analytic: true,
                required: true,
            },
        ],
    },
}
