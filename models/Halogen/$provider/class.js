/**
 * Halogen — гибридный провайдер ($provider) локального инференса (iGPU Radeon 8065S gfx1151 + Ryzen AI NPU 55 TOPS)
 * для ПАК ODANT-WORK на базе AMD Ryzen™ AI Max+ PRO 495 · 192 ГБ Unified Memory.
 *
 * Реализует Вариант 3 (Универсальный гибрид):
 *  - на Linux: прямое подключение к `halogen-flash-server` (:8731);
 *  - на Windows 11: локальный `llama-server` (ROCm/Vulkan) с Prompt Cache и Speculative Decoding + NPU/DirectML-контур;
 *  - при отсутствии внешнего процесса на :8731 автоматически работает через встроенный движок WORK.
 */
export default {
    icon: 'carbon:chip',
    label: 'Halogen (Ryzen AI 192 GB)',
    protocol: 'halogen',
    form: 'trainer',
    baseUrl: 'http://127.0.0.1:8731/v1/chat/completions',
}
