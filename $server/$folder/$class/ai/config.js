/**
 * Дефолты ИИ для класса (наследуются через ~, потомки переопределяют своим ai/config.js).
 *   model       — модель агентов, когда она не задана ни субагентом (model), ни задачей, ни вызовом;
 *   imageModel  — модель generate_image (по умолчанию первая с capability image);
 *   maxTurns    — лимит ходов основного агента (по умолчанию в ядре);
 *   ttsModel    — синтез речи голосового режима задачи (capability tts); нет или недоступна — речь браузера;
 *   sttModel    — распознавание речи (capability stt); нет или недоступна — распознавание браузера;
 *   voice       — { instructions?, language? } — голос и язык синтеза вместо заданных у модели;
 *   hooks       — хуки организации { pre_tool, post_tool, on_stop, on_compact }: функции или 'hooks/<имя>.js' из ai/ этого слоя;
 *                 слои складываются (не перекрывают друг друга), менять может только ADMIN (sources/modules/agent/hooks.js);
 *   dot         — внешний вид персонажа агента (work-dot): { color?: CSS-цвет, eyes: round | sleepy | happy,
 *                 accessory: none | glasses | cap }; у подразделения может быть свой «помощник».
 */
export default {
    model: '/MODELS/odant/Qwen3.8 27b',
    ttsModel: '/MODELS/odant/Qwen3-TTS',
    sttModel: '/MODELS/odant/Qwen3-ASR',
    dot: { eyes: 'round', accessory: 'none' },
};
