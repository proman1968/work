/**
 * Семантический реранкер на NPU: Qwen3-Reranker-0.6B (`/v1/rerank`)
 * Назначение: точное ранжирование найденных фрагментов документов и объектов учёта по релевантности запросу.
 */
export default {
    label: 'Qwen3-Reranker 0.6B (NPU Rerank)',
    icon: 'carbon:filter',
    protocol: 'halogen',
    baseUrl: 'http://127.0.0.1:8731/v1/rerank',
    model: 'qwen3-reranker-0.6b',
    modality: 'embed',
    maxTokens: 8192,
    functionCalling: false,
    capabilities: [
        'rerank',
        'rag',
    ],
    hfRepo: 'peonist-ai/halogen-npu-qwen3-reranker-0.6b',
    device: 'Ryzen AI NPU (55 TOPS)',
    trustLevel: 0,
};
