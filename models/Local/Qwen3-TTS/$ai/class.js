/**
 * Qwen3-TTS — локальный сервер синтеза речи (FastAPI :8002).
 *
 * Запуск: ?start → qwen3_start.bat
 * Готовность: GET baseUrl/health → model_loaded
 * Синтез: ?tts
 */
export default {
    icon: 'carbon:machine-learning-model',
    label: 'Qwen3-TTS',

    protocol: 'local',
    baseUrl: 'http://127.0.0.1:8002',
    model: 'Qwen3-TTS-12Hz-0.6B-CustomVoice',
    capabilities: ['tts'],
    batPath: 'sources/modules/tts/qwen3_start.bat',
}
