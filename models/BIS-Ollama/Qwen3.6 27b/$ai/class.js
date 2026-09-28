/**
 * Qwen3.6 27b — модель провайдера BIS-Ollama.
 *
 * Наследует настройки провайдера из родителя (models/BIS-Ollama).
 * Здесь только модельные параметры: model, maxTokens, capabilities.
 */
export default {
    label: 'Qwen3.6 27b',

    model: 'qwen3.6:27b',

    maxTokens: 131072,
    capabilities: ['chat', 'stream', 'functions', 'vision', 'effort'],
    effort: 'low',
}
