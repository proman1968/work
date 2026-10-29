/**
 * Предустановленная модель ПАК WORK: Embedding (Qwen3-Embedding-4B)
 * Назначение: семантический векторный поиск и RAG по документам, договорам и учётной базе.
 */
export default {
    label: 'Qwen3-Embedding (RAG)',
    icon: 'carbon:search-locate',
    protocol: 'local',
    baseUrl: 'http://127.0.0.1:8080/v1/embeddings',
    model: 'Qwen/Qwen3-Embedding-4B',
    modality: 'embedding',
    capabilities: [
        'embedding',
        'rag',
        'rerank',
    ],
    hfRepo: 'Qwen/Qwen3-Embedding-4B',
    weightsDir: 'MODELS/Local/Qwen3-Embedding/#weights',
    primaryFile: 'model.safetensors',
    pakPreinstalled: true,
};
