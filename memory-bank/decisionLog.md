# Журнал архитектурных решений

## Function calling: нативный вместо текстового парсинга — 2026-07-16

**Контекст.** ИИ-агент работал через текстовый парсинг `<tool_call>{"method":"...","args":{...}}</tool_call>` из ответа модели. Это ненадёжно: модели ломают JSON, путают кавычки, забывают теги. Платформа уже имела `streamChat` с поддержкой `functions` (OpenAI-compatible), но `prompt` метод не использовал эту возможность.

**Решение.** Внедрить нативный function calling:
1. `buildFunctionsFromSchema()` преобразует схему методов (из `get_schema`) в формат `[{name, description, parameters}]`
2. `prompt` передаёт `functions` + `function_call:'auto'` в `streamChat`
3. Цикл обрабатывает объекты `{type:'function_call', name, arguments}` из стрима
4. История диалога использует стандартный формат `role:'function'` с `name`
5. Fallback: текстовый парсинг `<tool_call>` сохранён для моделей без function calling

**Правило.** Схема методов класса — это и есть список инструментов агента. Не нужно дублировать описание инструментов в системном промпте — они передаются через `functions`.

## Баг: логи попадали в $work вместо meta_folder после ввода ролей — 2026-07-16

**Контекст.** После внедрения `get_storage({role})` файлы сохраняются в зону `$work` по роли пользователя. Но `_writeLogTo` в `file.js` передавал `role` в `storage.save_file()`, что направляло `data.logs` тоже в `$work`.

**Решение.** В `_writeLogTo` удаляем `role` из параметров и пишем от имени `globalThis.WORK`:
```js
const { role, ...rest } = log_param;
const systemLogParam = { ...rest, user: globalThis.WORK };
await storage.save_file(systemLogParam);
```

**Правило.** Логи — системная операция. Они всегда пишутся в `meta_folder/logs/` независимо от роли пользователя, сохранившего файл.

## Безопасность в объектной модели: роли admin/master/slaves — 2026-07-15

**Контекст.** Прежняя система (2 роли admin/users) размазана по `security.js` (731 строка), `class.js`, `folder.js`, `client/folder.js`. Логика наследования ролей была перепутана (masters не наследовался, slaves наследовался — оба наоборот).

**Модель (утверждена пользователем):**
- **admin** — системный администратор. Видит всё от точки вниз. Пишет SYSTEM (всё, кроме `$work`). Наследуется вниз.
- **master** — хозяин класса. Видит всё от точки вниз. Пишет MANAGEMENT (distributed `$work`). Наследуется вниз.
- **slave** — исполнитель. Видит только класс назначения. Пишет WORK (meta `$work`). НЕ наследуется.

**Решение.** Всю логику безопасности перенести в `$class` как методы и свойства. `security.js` — ликвидировать. Запись требует явного `params.role` от клиента (UI селектор ролей).

**Реализованные методы `$class`:**
- `roles(params)` — массив ролей через геттеры admins/masters/slaves
- `canSee(item, params)` — видимость элемента
- `canWrite(item, params)` — право записи (требует params.role)
- `allowAccess(params, level)` — единая проверка доступа
- `resolveZone(item)` — определение зоны: SYSTEM / MANAGEMENT / WORK

**Правило.** Безопасность — свойство класса, а не внешний модуль. Каждый класс самодостаточен.

## План-группа в микрочате: план прилипает к верху группы — 2026-07-14

**Контекст.** План рендерился отдельно над лентой (`<oda-chat-plan>` над thread), что сбивало с толку — план висел сам по себе, а не был связан с диалогом, который его породил.

**Решение.** Ввести понятие «план-группа»:
1. План парсится из ответа ИИ (`<plan>[...]</plan>`) → `msg.$plan` (`_loadTaskBody`)
2. `chatGroups` getter переорганизован: если ассистент создал план, текущая простая группа превращается в план-группу
3. План-группа имеет sticky header с промптом + планом (`oda-chat-plan` внутри группы)
4. Все последующие обмены (prompt + responses) добавляются в эту группу, пока план активен
5. При завершении всех шагов плана группа помечается `completed`, sticky снимается

**Структура `chatGroups`:**
```js
// План-группа
{
  type: 'plan',
  prompt: msg,
  plan: [...],
  completed: bool,
  exchanges: [
    { prompt: msg, responses: [...] },
    ...
  ]
}

// Простая группа
{
  type: 'simple',
  prompt: msg,
  responses: [...]
}
```

**Изменения в `$server/$folder/$file/$ai/handlers/preview/$handler/class.js`:**
1. CSS: `.plan-group-header` (sticky), `.plan-group-exchanges` (вложенность), `.plan-group-completed`
2. Шаблон: план-группа с `<template ~if="$for.item.type === 'plan'">`, простая группа — `<template ~if="$for.item.type !== 'plan'">`
3. `chatGroups` getter: логика создания план-группы и добавления обменов
4. `_loadTaskBody`: парсинг `<plan>` → `msg.$plan`

**Правило.** План всегда должен быть внутри группы, созданной промптом, который его вызвал. Не отделять план от контекста.