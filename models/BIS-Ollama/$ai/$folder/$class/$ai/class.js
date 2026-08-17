/**
 * BIS-Ollama — прототип для моделей провайдера BIS-Ollama.
 *
 * Наследуется всеми моделями внутри models/BIS-Ollama/.
 * OpenAI-совместимый API Ollama (/v1/chat/completions): protocol 'openai', auth не требуется.
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
