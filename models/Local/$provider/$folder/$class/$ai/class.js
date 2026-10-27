/**
 * Local — прототип моделей ($ai) локального провайдера /MODELS/Local.
 * Наследуется всеми локальными моделями через tilde (cross-type $provider → $ai).
 */
export default {
    icon: 'ai:ollama',
    description: 'Локальная модель ИИ',
    protocol: 'openai',
    baseUrl: 'http://127.0.0.1:8080/v1/chat/completions',
    functionCalling: true,
}
