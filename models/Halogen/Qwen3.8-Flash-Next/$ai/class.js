/**
 * Флагманская модель Halogen: Qwen3.8-Flash-Next (180B MoE, 4.16 bpw + FP8 n-gram lookup table)
 * Вычислитель: iGPU AMD Radeon 8065S (gfx1151) · 192 ГБ Unified Memory
 * Скорость: 73–94 tok/s decode, ~1800 tok/s prefill, первый токен в длинной агентской сессии за ~1.6 с.
 */
export default {
    label: 'Qwen3.8-Flash-Next (180B MoE)',
    icon: 'ai:qwen',
    protocol: 'halogen',
    baseUrl: 'http://127.0.0.1:8731/v1/chat/completions',
    model: 'halogen-qwen3.8-flash-next',
    modality: 'llm',
    maxTokens: 262144,
    maxOutput: 32768,
    efforts: ['off', 'low', 'medium', 'high'],
    effort: 'low',
    functionCalling: true,
    capabilities: [
        'chat',
        'stream',
        'tools',
        'functions',
        'vision',
        'effort',
        'thinking',
        'fork',
    ],
    hfRepo: 'peonist-ai/halogen-qwen3.8-flash-next',
    device: 'iGPU Radeon 8065S (gfx1151)',
    trustLevel: 0,
};
