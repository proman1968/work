/**
 * Распознавание речи на NPU: Qwen3-ASR-1.7B (`/v1/audio/transcriptions`)
 * Назначение: голосовой режим задачи (`ai/config.js → sttModel`), записи WAV до 20 минут.
 */
export default {
    label: 'Qwen3-ASR 1.7B (NPU STT)',
    icon: 'carbon:microphone',
    protocol: 'halogen',
    baseUrl: 'http://127.0.0.1:8731/v1/audio/transcriptions',
    model: 'qwen3-asr-1.7b',
    modality: 'audio',
    maxTokens: 4096,
    capabilities: [
        'stt',
        'asr',
    ],
    language: 'ru',
    hfRepo: 'peonist-ai/halogen-npu-qwen3-asr-1.7b',
    device: 'Ryzen AI NPU (55 TOPS)',
    trustLevel: 0,
};
