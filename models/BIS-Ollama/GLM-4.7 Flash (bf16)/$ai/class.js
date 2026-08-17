/**
 * GLM-4.7 Flash (bf16) — модель провайдера BIS-Ollama.
 *
 * Наследует настройки провайдера из родителя (models/BIS-Ollama).
 * Здесь только модельные параметры: model, maxTokens, capabilities.
 */
export default {
    icon: 'ai:glm',
    label: 'GLM-4.7 Flash (bf16)',

    model: 'glm-4.7-flash:bf16',

    maxTokens: 131072,
    capabilities: ['chat', 'stream', 'functions'],
}
