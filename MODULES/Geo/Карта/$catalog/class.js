export default {
    label: 'Карта (миксин)',
    icon: 'carbon:map',
    METADATA: {
        FIELDS: [
            { id: 'coords', label: 'Координаты', type: '/MODULES/Geo/Координаты' },
            { id: 'shape', label: 'Шейп / Контур', type: '/MODULES/Geo/Шейп' },
        ],
    },
}
