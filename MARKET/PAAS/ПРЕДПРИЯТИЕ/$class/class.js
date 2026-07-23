export default {
    icon: 'carbon:enterprise',
    label: 'ПРЕДПРИЯТИЕ',
    get $public() {
        return {
            price: 'от 3 000 ₽',
            priceHint: 'за пользователя / сутки',
            includes: [
                'Настраиваемые характеристики хранилища',
                'Настраиваемые характеристики производительности',
                'Стоимость за пользователя от 3 000 ₽',
                'Поддержка с максимальным приоритетом',
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
