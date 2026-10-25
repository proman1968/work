export default {
    CID: 'acc.norms',
    label: 'Нормативы',
    icon: 'carbon:calculator',
    NORMS: true,
    METADATA: {
        FIELDS: [
            {
                id: 'kind',
                label: 'Вид норматива',
                type: 'Link',
                target: 'cat.norm_kinds',
                analytic: true,
                required: true,
            },
            { id: 'object', label: 'Объект', type: 'Link', target: 'catalogs', analytic: true },
        ],
    },
}
