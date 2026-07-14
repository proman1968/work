/**
 * z.ai — прототип для моделей провайдера z.ai.
 *
 * Наследуется всеми моделями внутри models/z.ai/.
 */
export default {
    icon: 'carbon:machine-learning-model',
    description: 'Провайдер z.ai',

    protocol: 'openai',
    baseUrl: 'https://api.z.ai/api/coding/chat/completions',
    apiKey: '730fec7eaae74c548d54ccf7cb7d4c0b.a0k83gPNmNAaM4xv',
    model: 'glm-5.2',

    maxTokens: 4096,
    capabilities: ['chat', 'stream'],
}
