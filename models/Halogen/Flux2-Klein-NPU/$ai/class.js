/**
 * Генерация и редактирование изображений на NPU: FLUX.2-klein-4B (`/v1/images/generations`, `/v1/images/edits`)
 * Назначение: создание иконок, схем, иллюстраций и карточек номенклатуры до 1024×1024 за 4 шага (`ai/config.js → imageModel`).
 */
export default {
    label: 'FLUX.2-klein 4B (NPU Image)',
    icon: 'ai:stablediffusion',
    protocol: 'halogen',
    baseUrl: 'http://127.0.0.1:8731/v1/images/generations',
    model: 'flux2-klein-4b',
    modality: 'image',
    maxTokens: 4096,
    functionCalling: false,
    capabilities: [
        'image',
        'text-to-image',
    ],
    hfRepo: 'peonist-ai/halogen-npu-flux2-klein-4b',
    device: 'Ryzen AI NPU (55 TOPS)',
    trustLevel: 0,
};
