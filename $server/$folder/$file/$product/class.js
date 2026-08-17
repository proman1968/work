export default {
    icon: 'carbon:product',
    label: 'Продукт',
    contentType: 'application/json',
    METADATA: {
        FIELDS: {
            id: 'FIELDS',
            icon: 'iconoir:input-field',
            fields: [
                { id: 'label', type: 'string', label: 'Название' },
                { id: 'price', type: 'string', label: 'Стоимость' },
                { id: 'description', type: 'string', label: 'Описание' },
            ],
        },
    },
}
