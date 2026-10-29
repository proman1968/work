/**
 * Предустановленная модель ПАК WORK: Голосовой контур (Qwen3-ASR + Qwen3-TTS)
 * Назначение: полнодуплексный голосовой диалог с перебиванием, распознавание и синтез речи.
 */
export default {
    label: 'Qwen3-Voice (ASR + TTS)',
    icon: 'carbon:microphone',
    protocol: 'local',
    baseUrl: 'http://127.0.0.1:8080/v1/audio/speech',
    model: 'Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign',
    modality: 'audio',
    capabilities: [
        'asr',
        'tts',
        'voice',
    ],
    seed: 42,
    temperature: 0.2,
    top_p: 0.6,
    top_k: 20,
    voice: 'Warm, calm, friendly adult female Russian speaker, consistent natural timbre, clear studio diction, moderate conversational pace.',
    hfRepo: 'Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign',
    weightsDir: 'MODELS/Local/Qwen3-Voice/#weights',
    primaryFile: 'model.safetensors',
    pakPreinstalled: true,
};
