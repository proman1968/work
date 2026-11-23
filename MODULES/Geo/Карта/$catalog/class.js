export default {
    label: 'Карта',
    icon: 'carbon:map',
    abstract: true,
    METADATA: {
        FIELDS: [
            { id: 'coords', label: 'Координаты', type: '/MODULES/Geo/Координаты' },
            { id: 'shape', label: 'Шейп / Контур', type: '/MODULES/Geo/Шейп' },
        ],
    },
}
