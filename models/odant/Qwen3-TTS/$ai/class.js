/**
 * Qwen3-TTS (VoiceDesign) — синтез речи агента в голосовом режиме задачи.
 * Не чат-модель: в выборе модели не показывается, используется через ai/config.js `ttsModel`.
 * Через шлюз: voice обязателен (любое значение), task_type/language/instructions — только с заголовком
 * x-bf-passthrough-extra-params (его добавляет метод speak).
 */
export default {
    label: 'Qwen3-TTS',
    icon: 'carbon:volume-up',
    model: 'Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign',
    maxTokens: 2048,
    capabilities: ['tts'],
    ttsTask: 'VoiceDesign',
    voice: 'default',
    language: 'Russian',
    instructions: 'Спокойный дружелюбный женский голос, средний темп, чёткая дикция, ровные интонации без театральности',
    trustLevel: 0
}
