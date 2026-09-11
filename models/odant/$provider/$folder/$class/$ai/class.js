/**
 * odant — прототип моделей ($ai) провайдера odant.
 * Канал: protocol/baseUrl/apiKey наследуются моделями через tilde (cross-type $provider→$ai).
 */
export default {
    icon: 'carbon:machine-learning-model',
    description: 'Провайдер odant',

    protocol: 'openai',
    baseUrl: 'https://models.odant.org/v1/chat/completions',
    apiKey: 'sk-G9FoHwcfzYvzxSh9twAiREIOuhQhibcZu7lVdoK1W2sBjnzg',
    model: 'Tongyi-MAI/Z-Image-Turbo',

    maxTokens: 131072,
    capabilities: ['chat', 'stream', 'functions'],
    functionCalling: true,
    trustLevel: 0,
}
