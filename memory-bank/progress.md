# Журнал прогресса

> **📋 ИНСТРУКЦИЯ ДЛЯ НОВОЙ СЕССИИ:** Прочитай `memory-bank/activeContext.md` — там описана активная проблема стриминга и следующий шаг диагностики. Начни с него.

## Завершённые задачи

### Диагностика стриминга — 10.07.2026
- **Сервер**: стриминг РАБОТАЕТ — 15 chunks, 13 токенов от GigaChat, каждый отправляется через `WORK.wsSend`
- **Клиент**: `_onChatDelta` не вызывается — проблема в маршрутизации WS или рендеринге
- Добавлено логирование: `[streamChat] chunk`, `[prompt] token`, `[ai-preview] _onChatDelta`
- **Статус:** ожидается вывод консоли браузера от пользователя

### Bugfix: 404 No such model — 10.07.2026
- `chatOptions.model = body.model` передавало путь (`/models/GigaChat Pro`) в API GigaChat
- Убран `chatOptions` — `streamChat` сам берёт `ai.model` (`GigaChat-Pro`) из объекта модели

### Bugfix: selectedModelItem не отображался — 10.07.2026
- Убран `'info'` из `WORK.get_item(this.selectedModel)` — нужен полноценный Reactor-объект через `__bind`

### Инициализация model при создании task.ai — 10.07.2026
- `on_save` триггер: `body.model = modelPath` перед стримингом

### TITLE для меню + автозапись модели — 10.07.2026
- `WORK.showDropdown(tree, { TITLE: { label: 'Select model' } }, e)`
- `selectModel`: запись модели в тело через `this.$item.fetch('save', ...)`
- `_loadTaskBody`: автозапись первой найденной модели если не задана

### Bugfix: findModel is not defined — 10.07.2026
- Добавлена `findModel()` в `prompt/$method/data.js`
- `body.model` используется первым, `findModel()` — fallback
- Удалена устаревшая `findProvider()`

### Замена select на item-node + выпадающее дерево — 10.07.2026
- `<select>` заменён на `<item-node>` + `WORK.showDropdown` с `item-tree`

### Стриминговый вывод (on_save) — 09.07.2026
- `on_save` триггер переведён с `chat` на `streamChat`
- Цикл `for await` для каждого токена, WS `chat.delta`

### Панель инструментов ai-preview — 09.07.2026
- `item-node` + выпадающее дерево для выбора модели
- `oda-toggle` для Plan/Act
- `send()` отправляет JSON `{text, model}`

### Исправление ошибок микрочата — 09.07.2026
- `requestBody`: `request?.post`
- `on_save`: `import { pathToFileURL }` + динамический import

### Удаление мусорной архитектуры — 09.07.2026
- Удалены `file-handlers.js`, `skill-manager.js`, `skill-router.js`

### Серверный класс $handler — 09.07.2026
- `sources/server/handler.js` — `class $handler extends $storage`

### Единый тип $ai — 09.07.2026
- Один тип `$ai`, структура `models/$ai/` + `models/GigaChat Pro/`

## Незавершённое

### 1. 🔴 Починить клиентский стриминг (АКТИВНО)
### 2. Инструментарий агента (как в Cline)
- System prompt с описанием инструментов
- Цикл tool-call: read_file, write_file, list_dir, get_info, search
- Лимит итераций (10), логирование в chat[]
### 3. Удалить мусор `models/G`