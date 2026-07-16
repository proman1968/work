/**
 * $ai — прототип модели искусственного интеллекта.
 *
 * Объявлен внутри models/$ai/$folder/$class/$ai/.
 * Наследуется всеми $ai внутри models/.
 *
 * METADATA содержит поля для настройки провайдера и модели.
 * Серверная логика (HTTP-запросы к API) — в handlers/methods/.
 *
 * this.$context — экземпляр модели со значениями:
 *   protocol — 'openai' | 'anthropic' | 'gigachat' | 'custom'
 *   baseUrl  — URL API
 *   authUrl  — URL OAuth (для gigachat)
 *   apiKey   — ключ API
 *   scope    — scope для OAuth (gigachat)
 *   model    — имя модели (например, 'GigaChat-Pro')
 *   maxTokens — лимит токенов
 *   capabilities — возможности (['chat', 'stream', 'vision', ...])
 */
export default {
    icon: 'carbon:machine-learning-model',

    METADATA: {
        STATIC: {
            id: 'STATIC',
            icon: 'iconoir:input-field',
            fields: [{
                id: 'protocol',
                type: 'String',
                placeholder: 'openai | anthropic | gigachat | custom',
                required: true,
            }, {
                id: 'baseUrl',
                type: 'String',
                placeholder: 'https://ngw.devices.gigachat-api.ru/api/v2/chat/completions',
                required: true,
            }, {
                id: 'apiKey',
                type: 'String',
                placeholder: 'sk-...',
            }, {
                id: 'token',
                type: 'String',
                placeholder: 'Authorization key (GigaChat OAuth)',
                required: true,
            }, {
                id: 'authUrl',
                type: 'String',
                placeholder: 'https://ngw.devices.gigachat-api.ru/api/v2/oauth',
            }, {
                id: 'scope',
                type: 'String',
                placeholder: 'GIGACHAT_API_PERS',
            }, {
                id: 'model',
                type: 'String',
                placeholder: 'GigaChat-Pro',
                required: true,
            }, {
                id: 'maxTokens',
                type: 'Number',
                placeholder: '4096',
            }, {
                id: 'capabilities',
                type: 'String',
                placeholder: 'chat, stream',
            }, {
                id: 'functionCalling',
                type: 'Boolean',
                placeholder: 'false',
            }, {
                id: 'trustLevel',
                type: 'Number',
                placeholder: '0',
            }],
        },
    },

    /** Кэш access token для протоколов с OAuth */
    get accessToken() {
        return this._accessToken ?? null;
    },
    set accessToken(v) {
        this._accessToken = v;
    },
}