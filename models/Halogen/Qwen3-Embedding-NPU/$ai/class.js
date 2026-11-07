/**
 * Векторные эмбеддинги на NPU: Qwen3-Embedding-0.6B (`/v1/embeddings`)
 * Назначение: семантический поиск (RAG) по документам, задачам `.task` и справочникам WORK (~52 мс на запрос).
 */
export default {
    label: 'Qwen3-Embedding 0.6B (NPU RAG)',
    icon: 'carbon:search-locate',
    protocol: 'halogen',
    baseUrl: 'http://127.0.0.1:8731/v1/embeddings',
    model: 'qwen3-embedding-0.6b',
    modality: 'embed',
    maxTokens: 8192,
    functionCalling: false,
    capabilities: [
        'embeddings',
        'embedding',
        'rag',
    ],
    hfRepo: 'peonist-ai/halogen-npu-qwen3-embedding-0.6b',
    device: 'Ryzen AI NPU (55 TOPS)',
    trustLevel: 0,
};
