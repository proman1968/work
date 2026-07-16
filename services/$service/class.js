/**
 * $service — корневой тип внешних сервисов-коннекторов.
 *
 * METADATA содержит поля для настройки подключения.
 * Методы сервиса (methods/) доступны ИИ как функции (function calling).
 */
export default {
    icon: 'carbon:api',
    description: 'Внешние сервисы и коннекторы',

    METADATA: {
        STATIC: {
            id: 'STATIC',
            icon: 'iconoir:input-field',
            fields: [{
                id: 'baseUrl',
                type: 'String',
                placeholder: 'https://example.com',
            }, {
                id: 'apiKey',
                type: 'String',
                placeholder: 'API ключ (если требуется)',
            }, {
                id: 'capabilities',
                type: 'String',
                placeholder: 'search, translate, ...',
            }],
        },
    },
};
