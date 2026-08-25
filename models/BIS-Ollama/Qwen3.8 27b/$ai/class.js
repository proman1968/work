/**
 * Qwen3.8 27b — модель провайдера BIS-Ollama.
 *
 * Наследует настройки провайдера из родителя (models/BIS-Ollama).
 * Здесь только модельные параметры: model, maxTokens, capabilities.
 */
export default {
    icon: 'ai:qwen',
    label: 'Qwen3.8 27b',

    model: 'qwen3.8:27b',

    maxTokens: 131072,
    capabilities: ['chat', 'stream', 'functions', 'vision'],
}
