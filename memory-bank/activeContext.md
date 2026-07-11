# Текущий контекст работы

## ⚠️ АКТИВНАЯ ПРОБЛЕМА: Стриминг не отображается на клиенте

**Симптом:** При промпте в микрочате текст появляется сразу целиком, а не по токенам.

**Серверный стриминг РАБОТАЕТ** — подтверждено логами:
- 15 chunks от GigaChat, 13 токенов
- Каждый токен вызывает `WORK.wsSend({ type: "chat.delta", path: fullPath, token })`
- В консоли сервера видны `[streamChat] chunk #N size:...` и `[prompt] token #N:...`

**Проблема на клиенте** — WS-события `chat.delta` не вызывают `_onChatDelta` в preview handler.
Добавлено логирование в `_onChatDelta`: `console.log('[ai-preview] _onChatDelta token:', ...)`.

### Следующий шаг диагностики:
1. Запросить у пользователя вывод консоли браузера (F12) после промпта
2. Если `_onChatDelta` НЕ вызывается — проблема в маршрутизации WS:
   - Проверить `sources/client.js` строки 510-520 (WebSocketEvents.onmessage, case `chat.delta`)
   - `CORE.$item.ITEMS[data.path]` или fallback `Object.values(CORE.$item.ITEMS).find(i=>i.short === data.path)`
   - Возможная причина: `fullPath` на сервере не совпадает с ключом элемента
   - Добавить лог в `client.js` onmessage для `chat.delta`
3. Если `_onChatDelta` вызывается — проблема в рендеринге ODA

### Ключевые файлы:
- `models/$ai/$folder/$storage/$ai/handlers/methods/streamChat/$method/data.js` — AsyncGenerator, стриминг SSE
- `$server/$folder/$file/$ai/handlers/methods/prompt/$method/data.js` — серверный метод, цикл for await + wsSend
- `$server/$folder/$file/$ai/handlers/preview/$handler/data.js` — клиентский UI, _onChatDelta
- `sources/client.js` (строки 510-520) — WS onmessage, маршрутизация chat.delta
- `sources/server/server.js` — $server.wsSend()
- `$server/$folder/$file/$ai/triggers/on_save/$trigger/data.js` — триггер создания task.ai

### После исправления:
- Убрать диагностическое логирование (`[streamChat] chunk`, `[prompt] token`, `[ai-preview] _onChatDelta`)

---

## Что сделано

### Архитектура $ai ✅
- Один тип `$ai` для всех моделей
- `models/$ai/` — прототип + handlers (streamChat, chat)
- `models/GigaChat Pro/$ai/data.js` — конечная модель
- Поиск: `WORK.children → $ai → info({deep:-1}) → findFirstLeaf`

### Серверный класс $handler ✅
- `sources/server/handler.js` — `class $handler extends $storage`

### Стриминговый вывод ✅ (сервер)
- `on_save` и `prompt` — оба используют `streamChat` с циклом `for await`
- Каждый токен → `WORK.wsSend({ type: "chat.delta", path: fullPath, token })`

### Панель инструментов ✅
- `item-node` + `WORK.showDropdown(tree, { TITLE: { label: 'Select model' } }, e)` для выбора модели
- `oda-toggle` для Plan/Act
- `send()` отправляет JSON `{text, model}`
- `selectedModelItem` — `WORK.get_item(this.selectedModel)` (без 'info')
- `selectModel` — запись выбранной модели в тело через `this.$item.fetch('save', ...)`
- `_loadTaskBody` — автозапись модели в тело если не задана

### Инициализация model при создании task.ai ✅
- `on_save` триггер: `body.model = modelPath` перед стримингом

### Исправленные баги
- `findModel is not defined` → добавлена `findModel()`, удалена `findProvider()`
- 404 "No such model" → `chatOptions.model` убран, `streamChat` берёт `ai.model` сам
- `selectedModelItem` не отображался → убран `'info'` из `WORK.get_item`
- `requestBody undefined` → `request?.post` в http-server.js

### Ключи GigaChat
- token: MDE5YjJjZGUtMjUyYy03ZTY5LWE0ZDEtMzQyNzQxODBiYTFhOjAzMGY5MDhiLTIyMWYtNDY1Ny04ZDE2LWU4NWQxYjA2YTc5Mw==
- baseUrl: https://gigachat.devices.sberbank.ru/api/v1/chat/completions
- authUrl: https://ngw.devices.sberbank.ru:9443/api/v2/oauth
- model: GigaChat-Pro, scope: GIGACHAT_API_PERS

---

## Следующие задачи

### 1. Починить клиентский стриминг (АКТИВНО)
### 2. Инструментарий агента (как в Cline)
- System prompt с описанием инструментов
- Цикл tool-call: read_file, write_file, list_dir, get_info, search
- Лимит итераций, логирование
### 3. Удалить мусор `models/G`

---

## Важно
- Сервер: `node -e "process.env.WORK_DEV='true';import('./run.mjs')"`
- data: URL — статические import builtin модулей, динамический через pathToFileURL
- Кэш data.js сбрасывается перезапуском сервера
- Порты: 8001 (HTTP), 3478 (STUN)
- `.clinerules` — правила работы с кодовой базой WORK (раздел 0: «Суперсистемная система систем»)