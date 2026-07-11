/**
 * $ai — тип для моделей искусственного интеллекта.
 *
 * Любая папка с типом $ai внутри models/ — это модель (или провайдер, или и то и другое).
 * Крайние элементы дерева — конечные модели, доступные для вызова.
 *
 * Структура наследования:
 *   models/$ai/                          — этот тип
 *   models/$ai/$folder/$storage/$ai/     — прототип (METADATA, handlers)
 *   models/GigaChat Pro/                 — конкретная модель
 *
 * Handler'ы (chat, streamChat) вызываются через execItemMethod.
 * this.$context — экземпляр модели (protocol, apiKey, model, maxTokens, ...).
 */
export default {
    icon: 'carbon:machine-learning-model',
    description: 'Модели и провайдеры искусственного интеллекта',
}