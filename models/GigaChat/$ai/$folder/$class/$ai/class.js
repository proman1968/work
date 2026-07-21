/**
 * GigaChat — прототип для моделей провайдера GigaChat.
 *
 * Наследуется всеми моделями внутри models/GigaChat/.
 * Содержит общие настройки подключения и метаданные GigaChat.
 */
export default {
    icon: 'carbon:machine-learning-model',
    description: 'Провайдер GigaChat',

    protocol: 'gigachat',
    baseUrl: 'https://gigachat.devices.sberbank.ru/api/v1/chat/completions',
    authUrl: 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth',
    token: 'MDE5YjJjZGUtMjUyYy03ZTY5LWE0ZDEtMzQyNzQxODBiYTFhOjAzMGY5MDhiLTIyMWYtNDY1Ny04ZDE2LWU4NWQxYjA2YTc5Mw==',
    scope: 'GIGACHAT_API_PERS',

    /** Native tools / ask_user через streamChat (OpenAI-compatible functions) */
    functionCalling: true,
}
