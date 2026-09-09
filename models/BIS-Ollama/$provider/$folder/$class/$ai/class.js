/**
 * BIS-Ollama — прототип моделей ($ai) провайдера BIS-Ollama.
 * Канал: protocol/baseUrl наследуются моделями через tilde (cross-type $provider→$ai).
 */
export default {
    icon: 'ai:ollama',
    description: 'Провайдер BIS-Ollama',

    protocol: 'openai',
    baseUrl: 'https://ollama.odant.org/v1/chat/completions',
    model: 'gemma4:31b',

    maxTokens: 131072,
    capabilities: ['chat', 'stream', 'functions'],
    functionCalling: true,
    trustLevel: 0,
}
