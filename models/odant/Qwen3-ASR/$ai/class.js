/**
 * Qwen3-ASR — распознавание речи в голосовом режиме задачи (OpenAI-совместимый /v1/audio/transcriptions).
 * Не чат-модель: используется через ai/config.js `sttModel`.
 * model — id на шлюзе после установки (Qwen/Qwen3-ASR-1.7B или 0.6B): проверить GET /v1/models.
 * Пока модель на шлюзе не появилась, запросы падают, и голосовой режим работает через распознавание браузера.
 */
export default {
    label: 'Qwen3-ASR',
    icon: 'carbon:microphone',
    model: 'Qwen/Qwen3-ASR-1.7B',
    maxTokens: 2048,
    capabilities: ['stt'],
    language: 'ru',
    trustLevel: 0
}
