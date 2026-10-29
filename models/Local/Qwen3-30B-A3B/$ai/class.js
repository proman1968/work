/**
 * Предустановленная модель ПАК WORK: Qwen 3 30B (MoE A3B)
 * Назначение: основная языковая модель (диалог, ИИ-агент, учётные операции, аналитика, код).
 */
export default {
    label: 'Qwen 3 30B',
    icon: 'ai:qwen',
    protocol: 'local',
    baseUrl: 'http://127.0.0.1:8080/v1/chat/completions',
    model: 'Qwen/Qwen3-30B-A3B',
    modality: 'llm',
    maxTokens: 131072,
    maxOutput: 32768,
    functionCalling: true,
    effort: 'low',
    capabilities: [
        'chat',
        'stream',
        'tools',
        'functions',
        'effort',
        'thinking',
        'lora',
    ],
    hfRepo: 'Qwen/Qwen3-30B-A3B',
    weightsDir: 'MODELS/Local/Qwen3-30B-A3B/#weights',
    primaryFile: 'model-00001-of-00016.safetensors',
    pakPreinstalled: true,
};
