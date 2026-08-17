/**
 * DeepSeek — прототип для моделей провайдера DeepSeek.
 *
 * Наследуется всеми моделями внутри models/DeepSeek/.
 * API OpenAI-совместимый: protocol 'openai', auth — Bearer apiKey.
 * Thinking mode включён по умолчанию на стороне DeepSeek (параметр вызова, не подключения).
 */
export default {
    icon: 'ai:deepseek',
    description: 'Провайдер DeepSeek',

    protocol: 'openai',
    baseUrl: 'https://api.deepseek.com/chat/completions',
    apiKey: 'sk-42cfec13e6734c0694fb3aab83517cde',
    model: 'deepseek-v4-flash',

    maxTokens: 131072,
    capabilities: ['chat', 'stream', 'functions'],
    functionCalling: true,
    trustLevel: 0,
}