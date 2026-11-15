/**
 * Local — прототип моделей ($ai) единого локального провайдера /MODELS/Local.
 * Наследуется всеми локальными моделями через tilde (cross-type $provider → $ai).
 */
export default {
    icon: 'ai:ollama',
    description: 'Локальная модель ИИ',
    protocol: 'local',
    baseUrl: 'http://127.0.0.1:8731/v1/chat/completions',
    functionCalling: true,
}
