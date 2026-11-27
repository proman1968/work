/**
 * Local — единый провайдер ($provider) локальных моделей ИИ, дообучения (LoRA / SFT / GRPO)
 * и аппаратного контура Halo (AMD Ryzen™ AI Max+ PRO 395/495 · 128–192 ГБ Unified Memory: GPU + NPU).
 *
 * В чистой поставке папка /MODELS/Local содержит только метапапку $provider — дочерние узлы моделей ($ai)
 * создаются автоматически при установке модели (веса и загрузка хранятся внутри метапапки модели $ai/#weights).
 */
export default {
    icon: 'carbon:chip',
    label: 'Local',
    protocol: 'local',
    form: 'system',
    mainTreeChildren: ['$ai'],
    baseUrl: 'http://127.0.0.1:8731/v1/chat/completions',
}
