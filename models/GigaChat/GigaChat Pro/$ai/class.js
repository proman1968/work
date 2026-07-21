/**
 * GigaChat Pro — продвинутая модель GigaChat.
 *
 * Наследует настройки провайдера из родителя (models/GigaChat).
 * Здесь только модельные параметры: model, maxTokens, capabilities.
 */
export default {
    icon: 'ai:gigachat',
    label: 'GigaChat Pro',

    model: 'GigaChat-Pro',

    maxTokens: 4096,
    capabilities: ['chat', 'stream', 'functions'],
    functionCalling: true,
}