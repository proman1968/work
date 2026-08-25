/**
 * Llama3.1 8b — модель провайдера BIS-Ollama.
 *
 * Наследует настройки провайдера из родителя (models/BIS-Ollama).
 * Здесь только модельные параметры: model, maxTokens, capabilities.
 */
export default {
    icon: 'ai:llama3',
    label: 'Llama3.1 8b',

    model: 'llama3.1:8b',

    maxTokens: 131072,
    capabilities: ['chat', 'stream', 'functions'],
}
