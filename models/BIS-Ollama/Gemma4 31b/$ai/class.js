/**
 * Gemma4 31b — модель провайдера BIS-Ollama.
 *
 * Наследует настройки провайдера из родителя (models/BIS-Ollama).
 * Здесь только модельные параметры: model, maxTokens, capabilities.
 */
export default {
    icon: 'ai:gemma',
    label: 'Gemma4 31b',

    model: 'gemma4:31b',

    maxTokens: 131072,
    capabilities: ['chat', 'stream', 'functions'],
}
