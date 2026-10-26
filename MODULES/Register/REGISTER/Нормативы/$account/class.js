export default {    label: 'Нормативы',
    icon: 'carbon:calculator',
    NORMS: true,
    METADATA: {
        FIELDS: [
            {
                id: 'kind',
                label: 'Вид норматива',
                type: 'Link',
                target: '/MODULES/Register/CATALOGS/Виды нормативов',
                analytic: true,
                required: true,
            },
            { id: 'object', label: 'Объект', type: 'Link', target: '/MODULES/Register/CATALOGS', analytic: true },
        ],
    },
}
