/**
 * GLM-5.2 — модель провайдера z.ai.
 *
 * Наследует общие настройки из прототипа (protocol, baseUrl, apiKey).
 */
export default {
    icon: 'ai:gigachat',
    label: 'GLM-5.2',

    model: 'glm-5.2',

    maxTokens: 1048576,
    capabilities: ['chat', 'stream'],
}