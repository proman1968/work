export default {
    icon: 'carbon:rocket',
    label: 'СТАРТ',
    get $public() {
        return {
            price: 'бесплатно',
            priceHint: '',
            includes: [
                'Минимальный объём дискового пространства',
                'Минимальные вычислительные ресурсы',
                'Поддержка с низким приоритетом',
            ],
            FIELDS: [
                {
                    id: 'order',
                    type: 'form',
                    fields: [
                        {
                            id: 'name',
                            label: 'Имя',
                            type: 'text',
                            required: true,
                            placeholder: 'my-company',
                        },
                    ],
                },
            ],
        };
    },
}
