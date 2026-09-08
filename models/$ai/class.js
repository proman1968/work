/**
 * $ai — тип каталога /MODELS и прототип моделей.
 *
 * Слои (канон — MODELS/$ai/readme.md):
 *   /MODELS                 — каталог ($ai)
 *   /MODELS/<провайдер>    — канал/API ($provider, list_remote)
 *   /MODELS/<провайдер>/<модель> — конечная модель ($ai)
 *
 * Тип провайдера: MODELS/$ai/$folder/$class/$provider/
 * Прототип моделей: MODELS/$ai/$folder/$class/$ai/ и у провайдера
 *   <провайдер>/$provider/$folder/$class/$ai/
 */
export default {
    icon: 'carbon:machine-learning-model',
    description: 'Модели и провайдеры искусственного интеллекта',
}
