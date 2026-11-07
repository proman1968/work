/**
 * Малая генеративная модель на NPU: Qwen3.5-2B (Ryzen AI NPU sidecar)
 * Назначение: мгновенное фоновое сжатие контекста (`ai/config.js → compactModel`) и краткие сводки
 * (~39 tok/s на NPU без вымывания KV-пула основной модели на GPU).
 */
export default {
    label: 'Qwen3.5-2B (NPU Compact)',
    icon: 'ai:qwen',
    protocol: 'halogen',
    baseUrl: 'http://127.0.0.1:8731/v1/chat/completions',
    model: 'qwen3.5-2b',
    modality: 'llm',
    maxTokens: 32768,
    maxOutput: 4096,
    functionCalling: false,
    capabilities: [
        'chat',
        'stream',
    ],
    hfRepo: 'peonist-ai/halogen-npu-qwen3.5-2b',
    device: 'Ryzen AI NPU (55 TOPS)',
    trustLevel: 0,
};
