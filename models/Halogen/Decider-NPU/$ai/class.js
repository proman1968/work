/**
 * Однопроходный классификатор на NPU: Decider-0.8B (`/v1/systemone`)
 * Назначение: сверхбыстрые решения (choice / score / noul за ~45 мс) для маршрутизации запросов и голосового AI Barge-In.
 */
export default {
    label: 'Decider 0.8B (NPU SystemOne)',
    icon: 'carbon:decision-tree',
    protocol: 'halogen',
    baseUrl: 'http://127.0.0.1:8731/v1/systemone',
    model: 'decider-0.8b',
    modality: 'llm',
    maxTokens: 8192,
    maxOutput: 512,
    functionCalling: false,
    capabilities: [
        'decide',
        'classify',
    ],
    hfRepo: 'peonist-ai/halogen-npu-decider-0.8b',
    device: 'Ryzen AI NPU (55 TOPS)',
    trustLevel: 0,
};
