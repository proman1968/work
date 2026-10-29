/**
 * Предустановленная модель ПАК WORK: Генерация изображений (FLUX.1-schnell)
 * Назначение: локальный синтез иллюстраций, карточек номенклатуры, схем и визуальных материалов.
 */
export default {
    label: 'Flux-Image (Генерация изображений)',
    icon: 'ai:stablediffusion',
    protocol: 'local',
    baseUrl: 'http://127.0.0.1:8080/v1/images/generations',
    model: 'black-forest-labs/FLUX.1-schnell',
    modality: 'image',
    capabilities: [
        'image',
        'text-to-image',
    ],
    hfRepo: 'black-forest-labs/FLUX.1-schnell',
    weightsDir: 'MODELS/Local/Flux-Image/#weights',
    primaryFile: 'flux1-schnell.safetensors',
    pakPreinstalled: true,
};
