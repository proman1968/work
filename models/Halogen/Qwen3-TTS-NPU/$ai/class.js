/**
 * Синтез речи на NPU: Qwen3-TTS-1.7B CustomVoice (`/v1/audio/speech`)
 * Назначение: озвучивание ответов агента в голосовом режиме задачи (`ai/config.js → ttsModel`),
 * первый звук через ~350 мс, поддержка живого перебивания (Barge-In).
 */
export default {
    label: 'Qwen3-TTS 1.7B (NPU Voice)',
    icon: 'carbon:volume-up',
    protocol: 'halogen',
    baseUrl: 'http://127.0.0.1:8731/v1/audio/speech',
    model: 'qwen3-tts-1.7b-customvoice',
    modality: 'audio',
    maxTokens: 4096,
    capabilities: [
        'tts',
        'voice',
    ],
    ttsTask: 'CustomVoice',
    voice: 'serena',
    language: 'russian',
    seed: 42,
    instructions: 'Calm, confident, friendly business assistant, clear studio diction, moderate conversational pace.',
    hfRepo: 'peonist-ai/halogen-npu-qwen3-tts-1.7b-customvoice',
    device: 'Ryzen AI NPU (55 TOPS)',
    trustLevel: 0,
};
