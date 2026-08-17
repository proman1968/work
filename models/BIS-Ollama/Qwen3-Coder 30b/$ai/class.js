/**
 * Qwen3-Coder 30b — модель провайдера BIS-Ollama.
 *
 * Наследует настройки провайдера из родителя (models/BIS-Ollama).
 * Здесь только модельные параметры: model, maxTokens, capabilities.
 */
export default {
    icon: 'ai:qwen',
    label: 'Qwen3-Coder 30b',

    model: 'qwen3-coder:30b',

    maxTokens: 131072,
    capabilities: ['chat', 'stream', 'functions'],
}
