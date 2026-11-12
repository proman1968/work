export default {
    label: '08 Вложения во внеоборотные активы',
    icon: 'carbon:construction',
    METADATA: {
        FIELDS: [
            { id: 'asset', label: 'Объект вложений', type: 'Link', target: '/MODULES/Register/CATALOGS/Номенклатура', analytic: true },
        ],
    },
}
