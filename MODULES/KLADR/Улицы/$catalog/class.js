export default {
    label: 'Улицы',
    icon: 'carbon:road',
    METADATA: {
        FIELDS: [
            { id: 'name', label: 'Наименование', type: 'string', required: true },
            { id: 'socr', label: 'Тип (ул, пр-кт, пер)', type: 'string' },
            { id: 'settlement', label: 'Населённый пункт', type: 'link', target: '/MODULES/KLADR/Населённые пункты' },
            { id: 'postcode', label: 'Индекс', type: 'string' },
            { id: 'kladr_code', label: 'Код КЛАДР', type: 'string' },
        ],
    },
}
