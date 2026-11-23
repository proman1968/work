export default {
    label: 'Шейп / Геозона',
    icon: 'carbon:area',
    METADATA: {
        FIELDS: [
            {
                id: 'kind',
                label: 'Тип геометрии',
                type: 'enum',
                values: ['point', 'line', 'polygon', 'circle'],
            },
            { id: 'geojson', label: 'Геометрия (GeoJSON / точки)', type: 'text' },
            { id: 'radius', label: 'Радиус, м', type: 'number' },
            { id: 'color', label: 'Цвет', type: 'string' },
        ],
    },
}
