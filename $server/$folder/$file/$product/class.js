export default {
    icon: 'carbon:product',
    label: 'Продукт',
    FIELDS: [
        { id: 'label', type: 'string', label: 'Название' },
        { id: 'icon', type: 'string', label: 'Иконка' },
        { id: 'price', type: 'string', label: 'Цена' },
        { id: 'priceHint', type: 'string', label: 'Подсказка к цене' },
        { id: 'includes', type: 'array', label: 'Что входит', of: { type: 'string' } },
        {
            id: 'orderForm',
            label: 'Форма заказа',
            fields: [
                { id: 'id', type: 'string' },
                { id: 'type', type: 'string', options: ['form'] },
                {
                    id: 'fields',
                    type: 'array',
                    fields: [
                        { id: 'id', type: 'string' },
                        { id: 'label', type: 'string' },
                        { id: 'type', type: 'string', options: ['text', 'textarea', 'select', 'checkbox', 'number', 'email', 'date'] },
                        { id: 'options', type: 'array' },
                        { id: 'required', type: 'boolean' },
                        { id: 'placeholder', type: 'string' },
                    ],
                },
            ],
        },
        { id: 'status', type: 'string', options: ['draft', 'published'], label: 'Статус' },
    ],
}
