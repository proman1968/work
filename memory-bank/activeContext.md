# Текущий контекст работы

## Текущая задача: Function calling для ИИ

### Этап 1: streamChat — поддержка functions ✅
- `models/$ai/$folder/$class/$ai/methods/streamChat/$method/class.js`
- Без `functions` — yield строк (обратная совместимость)
- С `functions` — yield объектов `{type: 'content', content}` или `{type: 'function_call', name, arguments}`
- Парсит `delta.tool_calls[].function` и `delta.function_call` из SSE
- Отправляет `body.functions` и `body.function_call` в API

### Этап 2: prompt — построение functions из get_schema (НЕ НАЧАТ)
В `$server/$folder/$file/$ai/methods/prompt/$method/class.js`:
- Получить схему через `get_schema()` контекста
- Преобразовать методы в формат `functions` (OpenAI-compatible)
- Передать `functions` в `streamChat`
- Обрабатывать `{type: 'function_call', name, arguments}` из стрима
- Заменить `parseToolCalls` (текстовый парсинг) на нативный

### Этап 3: История диалога с function call (НЕ НАЧАТ)
В `buildHistoryFromChat`:
- `role: "assistant"` с `function_call`
- `role: "function"` с результатом вызова

## Завершено ранее: Безопасность + чат + UI

### Система безопасности (admin/master/slaves) — полностью в объектной модели
- `sources/host/security.js` — УДАЛЕН
- `sources/server/class.js` — ROLES/ZONES/ACCESS_LEVEL, roles(), canSee(), canWrite(), allowAccess(), resolveZone(), chatSource(), get_storage({role}), ensureBootstrapAdmin()
- `sources/server/folder.js` — allowAccess() делегирует к $owner
- `sources/client/folder.js` — role через $public/$save, fetch() подставляет params.role, цвет --main-color

### Ролевая модель чата
- slave → логи `$user`, файлы в `meta/$work/`
- master → логи класса, файлы в `distributed/$work/`
- admin → логи `$user`, файлы в `$folder/$work/`

### UI компоненты
- `item-node` — admin (щит), master (галстук), slaves (массив)
- `item-users` — два режима: чат (выбор receivers) / дерево (управление ролями)
- Цветовая индикация: admin=red, master=green, slave=indigo

## Технический долг
- HTTP-фильтрация (canSee для info/get_item) — отключена, TODO в http-server.js
- Старые тесты удалены, новые не написаны