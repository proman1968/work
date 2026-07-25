/**
 * Piper — быстрый локальный TTS (ONNX, порт 8003).
 *
 * Запуск: ?start → piper_start.bat
 * Готовность: GET baseUrl/health → model_loaded
 * Синтез: ?tts
 */
export default {
    icon: 'carbon:microphone',
    label: 'Piper',

    protocol: 'local',
    baseUrl: 'http://127.0.0.1:8003',
    model: 'ru_RU-irina-medium',
    capabilities: ['tts'],
    batPath: 'sources/modules/tts/piper_start.bat',
}
