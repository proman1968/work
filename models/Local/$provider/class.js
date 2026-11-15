/**
 * Local — единый провайдер ($provider) локальных моделей ИИ, дообучения (LoRA / SFT / GRPO)
 * и аппаратного контура Halo (AMD Ryzen™ AI Max+ PRO 395/495 · 128–192 ГБ Unified Memory: GPU + NPU).
 *
 * В чистой поставке папка /MODELS/Local пуста — дочерние узлы моделей ($ai) создаются автоматически
 * только после реального скачивания весов модели в /MODELS/Local/<Модель>/#weights.
 */
export default {
    icon: 'carbon:chip',
    label: 'Local',
    protocol: 'local',
    form: 'trainer',
    baseUrl: 'http://127.0.0.1:8731/v1/chat/completions',
}
