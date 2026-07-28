/**
 * $ai — тип для моделей искусственного интеллекта.
 *
 * Любая папка с типом $ai внутри models/ — это модель (или провайдер, или и то и другое).
 * Крайние элементы дерева — конечные модели, доступные для вызова.
 *
 * Структура наследования:
 *   MODELS/$ai/                          — этот тип
 *   MODELS/$ai/$folder/$class/$ai/     — прототип (METADATA, handlers)
 *   models/GigaChat/                     — провайдер
 *   models/GigaChat/GigaChat Pro/        — конкретная модель
 *   models/GigaChat/GigaChat Light/      — конкретная модель
 *
 * streamChat — метод прототипа `$folder/$class/$ai/class.js` (вызов: model.streamChat).
 * chat / tts — `$method`; HTTP также резолвит class-методы через execItemMethod.
 */
export default {
    icon: 'carbon:machine-learning-model',
    description: 'Модели и провайдеры искусственного интеллекта',
}