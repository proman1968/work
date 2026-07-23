export default {
    icon: 'carbon:building',
    label: 'БИЗНЕС',
    get $public() {
        return {
            price: 'от 2 000 ₽',
            priceHint: 'за пользователя / сутки',
            includes: [
                'Увеличенный объём диска',
                'Увеличенные вычислительные ресурсы',
                'Стоимость на пользователя в сутки — 2 000 ₽',
                'Поддержка со средним приоритетом',
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
