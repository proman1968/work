/**
 * GigaChat — прототип для моделей провайдера GigaChat.
 *
 * Наследуется всеми моделями внутри models/GigaChat/.
 * Содержит общие настройки подключения и метаданные GigaChat.
 */
export default {
    icon: 'ai:gigachat',
    description: 'Провайдер GigaChat',

    protocol: 'gigachat',
    baseUrl: 'https://gigachat.devices.sberbank.ru/api/v1/chat/completions',
    authUrl: 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth',
    /** Authorization key: файл /MODELS/GigaChat/$provider/#secret/gigachat.json ({"token": "..."}); запасной вариант — env GIGACHAT_KEY. */
    token: 'secret:gigachat.json',
    scope: 'GIGACHAT_API_PERS',

    /** Native tools / ask_user через streamChat (OpenAI-compatible functions) */
    functionCalling: true,
}
