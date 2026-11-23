export default {
    label: 'Населённые пункты',
    icon: 'carbon:location-company',
    METADATA: {
        FIELDS: [
            { id: 'name', label: 'Наименование', type: 'string', required: true },
            { id: 'socr', label: 'Тип (г, пгт, с)', type: 'string' },
            { id: 'region', label: 'Регион', type: 'link', target: '/MODULES/KLADR/Регионы' },
            { id: 'postcode', label: 'Индекс', type: 'string' },
            { id: 'kladr_code', label: 'Код КЛАДР', type: 'string' },
            { id: 'fias_id', label: 'ФИАС GUID', type: 'string' },
        ],
    },
}
