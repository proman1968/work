/**
 * Halogen — прототип моделей ($ai) гибридного провайдера /MODELS/Halogen.
 * Наследуется всеми моделями в /MODELS/Halogen/* через tilde (cross-type $provider → $ai).
 */
export default {
    icon: 'ai:qwen',
    description: 'Гибридная модель Halogen (AMD Ryzen AI 495 Pro 192 GB: iGPU + NPU)',
    protocol: 'halogen',
    baseUrl: 'http://127.0.0.1:8731/v1/chat/completions',
    functionCalling: true,
}
