/**
 * DeepSeek V4 Flash — облегчённая модель провайдера DeepSeek.
 *
 * Наследует настройки провайдера из родителя (models/DeepSeek).
 * Здесь только модельные параметры: model, maxTokens, capabilities.
 */
export default {
    icon: 'ai:deepseek',
    label: 'DeepSeek V4 Flash',

    model: 'deepseek-v4-flash',

    maxTokens: 131072,
    capabilities: ['chat', 'stream', 'functions'],
}