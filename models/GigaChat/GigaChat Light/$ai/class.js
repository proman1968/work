/**
 * GigaChat Light — облегчённая модель GigaChat.
 *
 * Наследует настройки провайдера из родителя (models/GigaChat).
 * Здесь только модельные параметры: model, maxTokens, capabilities.
 */
export default {
    icon: 'ai:gigachat',
    label: 'GigaChat Light',

    model: 'GigaChat-2',

    maxTokens: 32768,
    capabilities: ['chat', 'stream', 'functions'],
    functionCalling: true,
}