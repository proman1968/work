export default {    label: 'Кадры',
    icon: 'carbon:user-role',
    METADATA: {
        FIELDS: [
            { id: 'person', label: 'Сотрудник', type: 'Link', target: '/MODULES/Register/CATALOGS/Субъекты/Физ. лица', required: true },
            { id: 'order_number', label: 'Номер приказа' },
        ],
    },
}
