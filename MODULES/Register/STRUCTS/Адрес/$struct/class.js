export default {
    label: 'Адрес',
    icon: 'carbon:location',
    METADATA: {
        FIELDS: [
            { id: 'postcode', label: 'Индекс', type: 'string' },
            { id: 'region', label: 'Регион', type: 'string' },
            { id: 'city', label: 'Город / Населённый пункт', type: 'string' },
            { id: 'street', label: 'Улица', type: 'string' },
            { id: 'house', label: 'Дом', type: 'string' },
            { id: 'flat', label: 'Квартира / Офис', type: 'string' },
        ],
    },
}
