/**
 * Qwen3-TTS (VoiceDesign) — синтез речи агента в голосовом режиме задачи.
 * Не чат-модель: в выборе модели не показывается, используется через ai/config.js `ttsModel`.
 * Через шлюз: voice обязателен (любое значение), task_type/language/instructions — только с заголовком
 * x-bf-passthrough-extra-params (его добавляет метод speak).
 */
export default {
    label: 'Qwen3-TTS',
    icon: 'carbon:volume-up',
    model: 'vllm-tts-qwen3-vd/Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign',
    maxTokens: 2048,
    capabilities: ['tts'],
    ttsTask: 'VoiceDesign',
    voice: 'default',
    language: 'Russian',
    seed: 42,
    temperature: 0.2,
    topP: 0.6,
    topK: 20,
    instructions: 'Gender: Female. Age: 30 years old, adult woman. Pitch: Medium-low, warm contralto, steady and consistent pitch. Speed: Moderate, calm conversational pace. Emotion: Calm, confident, friendly business assistant. Studio quality microphone, single consistent speaker, no child voice, no male voice.',
    trustLevel: 0
}
