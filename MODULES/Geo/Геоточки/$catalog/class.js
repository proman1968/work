export default {
    label: 'Геоточки',
    icon: 'carbon:map',
    METADATA: {
        FIELDS: [
            { id: 'name', label: 'Название', required: true },
            { id: 'coords', label: 'Координаты', type: '/MODULES/Geo/Координаты' },
            { id: 'address', label: 'Адрес', type: 'Text' },
        ],
    },
}
