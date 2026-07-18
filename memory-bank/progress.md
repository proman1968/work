# Журнал прогресса

> **📋 ИНСТРУКЦИЯ ДЛЯ НОВОЙ СЕССИИ:** Прочитай `memory-bank/activeContext.md` — там описано текущее рабочее состояние ИИ-инфраструктуры.

## Завершённые задачи

### Развитие ИИ-архитектуры — 17.07.2026 (поздний вечер)

- **Починка on_save trigger (критический баг)** — триггер работал со старым форматом `body.chat`, который больше не существует. Заменён на `body.ribbon` во всём триггере: извлечение промпта через `ribbon.find(m => m.role === 'user')`, проверка ответа через `ribbon.some(m => m.role === 'assistant')`
- **Удаление мёртвого кода pendingPlan** — клиентский `onAction()`/`onCancelAction()` содержали проверки `pendingPlan`, которое сервер никогда не устанавливал. Удалены оба блока, остался только `pendingAction`
- **Завершение плана на сервере** — исправлен баг: `plan_created` → `block` (parseResponseToRibbon создаёт `type:'block'`). Добавлена проверка завершения: все шаги `done` → `activeTask.state = 'completed'` + WS `chat.plan_completed`
- **SYSTEM_PROMPT обновлён** — PDCA-цикл переписан: подтверждение через `<action>`, обновление статусов, автоматическое завершение. Латынь заменена на русский

**Изменённые файлы:**
- `$server/$folder/$file/$ai/triggers/on_save/$trigger/class.js` — body.chat→body.ribbon, SYSTEM_PROMPT
- `$server/$folder/$file/$ai/handlers/preview/$handler/class.js` — удаление pendingPlan
- `$server/$folder/$file/$ai/methods/prompt/$method/class.js` — завершение плана, исправление planBlock

### TTS: единый локальный движок Silero ONNX — 17.07.2026

- **Убраны все движки TTS** кроме Silero ONNX: GigaChat TTS, Qwen3 TTS, browser speechSynthesis удалены
- **`sources/modules/tts/tts.js`** — перезаписан целиком: только `sileroTTS()` + `synthesize()`, корректная таблица фонем Silero
- **Серверный метод `?tts`** — создан `$server/$folder/$file/$ai/methods/tts/$method/class.js`: POST `{text}` -> WAV Buffer
- **`sources/host/http-server.js`** — добавлена обработка `Buffer.isBuffer(result)` -> `Content-Type: audio/wav`
- **Клиент `preview/$handler`** — упрощён до одной кнопки TTS (вкл/выкл): `ttsMode` (4 режима) -> `ttsEnabled` (boolean), убраны _speakBrowser, _speakServer
- **Зависимость:** `onnxruntime-node` установлен через npm

**Изменённые файлы:**
- `sources/modules/tts/tts.js` — полная перезапись
- `$server/$folder/$file/$ai/methods/tts/$method/class.js` — новый файл
- `sources/host/http-server.js` — Buffer -> audio/wav
- `$server/$folder/$file/$ai/handlers/preview/$handler/class.js` — упрощение TTS UI

### Стабилизация ИИ-инфраструктуры — 17.07.2026 (вечер)

- **Разминификация `buildHistoryFromRibbon`** — функция в одну строку (стр. 425) разбита на читаемый код с JSDoc
- **Подтверждение опасных действий (сервер)** — `DANGEROUS_METHODS` + `TRUST_AUTOCONFIRM` теперь работают:
  - При `trustLevel < 3` опасные методы сохраняются в `body.pendingAction`, WS `chat.action`
  - При подтверждении — выполнение через `executeToolCall()`, при отказе — tool_result "отменено"
  - Парсинг `confirm` из входящего JSON
- **Рефакторинг `execute()` в `prompt`** — разбит на 9 нумерованных секций:
  - `executeToolCall()` — единая функция выполнения tool_call (контекст, сервисы, навигация)
  - `buildFunctionsList()` — построение functions из схемы + сервисов
  - `pushToolResult()`, `sendToolResultWs()` — устранение дублирования
- **Починить смешение `chat`/`ribbon` в клиенте:**
  - `onFormAnswer()` — поиск в `taskBody.ribbon` (было `this.chat` → undefined)
  - `msg.$questions` → `msg.questions`
  - `_loadTaskBody()` — работает только с `body.ribbon`
  - `_onChanged()` — убраны мёртвые `this.chat`, `this.chatGroups`
  - `activeTask` getter — `t.status` → `t.state`
  - `parseResponseToRibbon()` — создаёт `type:'action'` и `type:'block'` с `action:true`
- **Удаление дубликатов `$storage`:**
  - `models/$ai/$folder/$storage/` — удалён
  - `models/GigaChat/$ai/$folder/$storage/` — удалён

**Изменённые файлы:**
- `$server/$folder/$file/$ai/methods/prompt/$method/class.js` — рефакторинг + подтверждение действий
- `$server/$folder/$file/$ai/handlers/preview/$handler/class.js` — исправление chat/ribbon

### Архитектурная чистота ИИ (Вектор A) — 17.07.2026
- **Сервис Weather** — погода wttr.in вынесена из web_search в `services/Weather/$service/`
- **SearXNG очищен** — убрана погода, метод `web_search` → `search` (чистый DuckDuckGo)
- **web_search удалён** — папка `$ai/methods/web_search/` целиком удалена
- **SYSTEM_PROMPT очищен** — убраны секции «Доступные методы» и «Вызов методов (текстовый формат)»
- **pendingAction + trustLevel** — серверная логика подтверждения опасных действий:
  - `DANGEROUS_METHODS` = write_file, set_property, save_file, delete, create
  - `TRUST_AUTOCONFIRM = 3` — автоподтверждение при trustLevel ≥ 3
  - При trustLevel < 3 — `body.pendingAction` + `chat.action` → ждёт `{confirm: true/false}`
- **Динамический parseToolCalls** — убран хардкод `knownMethods`, сверка с `functions`
- **findFirstModel()** — вынесена в `sources/modules/ai-schema.js`, удалено дублирование из prompt и on_save

### Site-витрина, user-slot, guest redirect — 16.07.2026
- Shell: tabs + iframe keep-alive + nested `main` (`view_name`)
- Base main (hero) в `$folder`; WORK main + shell-копия в `$server/handlers/site`
- User-slot только top-level; modal `user-profile`
- `page.html`: гости → site контекста (кроме самого site)
- **Уроки:** не re-export через `~/class.js` merge; `$server/handlers/site` только с `$handler/`; не менять iframe `src` на месте
- **Док:** `$server/$folder/handlers/pages/site/readme.md`

### Рефакторинг системы безопасности (admin/master/slaves) — 15.07.2026
- **Модель:** 3 роли (admin, master, slaves), 3 зоны (SYSTEM, MANAGEMENT, WORK)
- admin/master наследуются вниз, slave — только класс назначения
- Запись требует params.role от клиента
- **Этап 1 ✅:** Ядро безопасности в `$class` — roles/canSee/canWrite/allowAccess/resolveZone
- **Этап 2 ✅:** `$folder`+`$file` — делегирование allowAccess к $owner, убран импорт security.js
- **Изменённые файлы:** `sources/server/class.js`, `sources/server/folder.js`, `sources/server/file.js`
- **Осталось:** HTTP-слой, клиент, удаление security.js, очистка легаси

### Глобальное переименование data.js → class.js — 14.07.2026
- **Масштаб:** 159 файлов переименовано, 46 файлов кода обновлено
- Имя `'data.js'` зашито в серверном коде ~10 местах (`f.id === 'data.js'`, `filename: 'data.js'`, `get_item('~/data.js')`)
- Все ссылки заменены на `'class.js'`
- Массовая замена исключала `oda/`, `torus/`, `node_modules/`, `.venv/`
- **УРОК:** `replaceAll('data.js', 'class.js')` слишком грубо — задело клиентские файлы с динамическими путями. Пользователь исправил вручную.
- Вспомогательные скрипты удалены после использования
- Тесты: 15/18 проходят (3 падения в `distributed-folder.test.js` не связаны)

### Глобальное переименование $storage → $class — 14.07.2026
- **Масштаб:** 58 файлов + 6 директорий + 2 файла переименованы
- sources/server/storage.js → class.js, sources/client/storage.js → class.js
- 6 директорий $storage → $class
- tests/storage/ → tests/class/
- Заменены: $storage → $class, isStorageItem → isClassItem, nearestStorage → nearestClass, hasStorageAccess → hasClassAccess
- Сохранено: storage_folder
- Тесты: 15/18 проходят

### Очистка остатков переименования $storage → $class, data.js → class.js — 14.07.2026
- **Удалено 6 папок `$storage`** — дубликаты `$class` (в $server, models, services, skills)
- **Удалено 108 файлов `data.js`** — дубликаты рядом с `class.js`
- **Переименован 1 файл** `data.js` → `class.js` (users/CA4E097FF6C1D387/$user/)
- **Исправлено 5 файлов** с `.$storage` → `.$class` (paas, services, $order trigger)
- **Проверены цепочки наследования $-папок** — структура корректна: $folder → $file/$class/$handler → $method/$trigger/$structure → $base/$group/$server/$user/$device

### Bugfix: buildAiSchema — обход цепочки прототипов — 14.07.2026
- **Баг:** `?get_schema` не показывал `@ai` метаданные для `$class`/`$file`
- **Причина:** `Object.getOwnPropertyNames(proto)` возвращает методы только собственного прототипа
- **Решение:** `buildAiSchema` обходит всю цепочку через `Object.getPrototypeOf()`

### JSDoc @ai-разметка методов для ИИ — 14.07.2026
- **Критическая находка**: `Function.prototype.toString()` в V8 НЕ сохраняет JSDoc-комментарии
- Переписан `sources/modules/ai-schema.js` — `buildAiSchema(proto)` парсит исходный файл через `constructor.sourceUrl`
- Добавлен `static sourceUrl = import.meta.url` в `$folder`, `$class`, `$file`
- Ключевые методы помечены `@ai`, `@ai.params`, `@ai.returns`
- `TOOL_DESCRIPTIONS` наследуется через `...$folder.TOOL_DESCRIPTIONS`
- `get_schema()` переведён на `buildAiSchema` (вместо инлайн-логики с reserved-списком)
- Убраны отладочные `console.log` из `preview/$handler/class.js` (TTS-логи)

### Bugfix: стриминг + повторные промпты — 13.07.2026
- **Ошибка `Invalid URL`** при втором промпте в микрочате
  - Причина: `this` в `streamChat.execute` — это handler ($method), а не модель, из-за Reactor bound-функции
  - Решение: модель передаётся через `params.$ai` вместо `this`
- **Ошибка `ai.import is not a function`**
  - Причина: handler ($method, наследник $folder) не имеет метода `import`
  - Решение: убран `ai.import()`, модель уже загружена через `params.$ai`
- **Стриминг не работал** (текст появлялся весь сразу в конце)
  - Причина: WS-сообщения `chat.delta` отправлялись с полным путём (`item.path`), а клиент хранит элементы по короткому пути (`item.short` с `~`)
  - Решение: все `WORK.wsSend` используют `wsPath = taskAi.short` вместо `fullPath`

### Ревизия фреймворка ODA — 11.07.2026
- **Глубокий аудит** `oda.js`, `reactor.js`, всех компонентов и инструментов
- **Reactor.js — 2 исправления:**
  1. `collect_deps`: добавлена проверка `if (!actor) return` — защита от TypeError при доступе к prototype
  2. `Reactor.get`: добавлен `try/finally` вокруг вызова геттера — коллектор зависимостей корректно восстанавливается при исключении
- **oda.js — 3 исправления:**
  1. `for...in` → `for...of` в конструкторе компонента — инициализация public/attr свойств теперь работает корректно
  2. `DIRECTIVES.is`: `this.nodeName.toLowerCase` → `toLowerCase()` — директива `~is` теперь динамически меняет тег элемента
  3. `requireInteraction: options.requireInteraction || true` → `?? true` — `false` теперь не превращается в `true`
- **Подтверждено:** `utils.js` — мёртвый файл (нигде не импортируется), кандидат на удаление
- **Не исправлено (требует обсуждения):**
  - Система слотов: рассинхронизация `renderChildren` при перемещении slotted-элементов
  - `reset_deps` рекурсивный без лимита глубины
  - `Array.reset_deps(this)` без key — избыточная инвалидация

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
- Добавлена `findModel()` в `prompt/$method/class.js`
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
- `sources/server/handler.js` — `class $handler extends $class`

### Единый тип $ai — 09.07.2026
- Один тип `$ai`, структура `models/$ai/` + `models/GigaChat Pro/`

### Нативный function calling для ИИ — 16.07.2026
- **Багфикс логов:** `_writeLogTo` в `sources/server/file.js` — удалён `role` из параметров, логи пишутся от имени WORK → всегда попадают в `meta_folder/logs/`
- **`buildFunctionsFromSchema()`** в `sources/modules/ai-schema.js` — преобразует схему методов в OpenAI-compatible functions
- **Цикл prompt** (`$server/$folder/$file/$ai/methods/prompt/$method/class.js`):
  - Строит `functions` из `get_schema()` контекста каждую итерацию
  - Передаёт `functions` + `function_call:'auto'` в `streamChat`
  - Обрабатывает `{type:'content'}` и `{type:'function_call'}` из стрима
  - Сохраняет `function_call` в истории ассистента для нативного формата
  - Fallback: текстовый парсинг `<tool_call>` сохранён для моделей без function calling
- **SYSTEM_PROMPT** обновлён: убрано обучение текстовому формату `<tool_call>`, описаны инструменты через function calling
- **Изменённые файлы:** `sources/server/file.js`, `sources/modules/ai-schema.js`, `$server/$folder/$file/$ai/methods/prompt/$method/class.js`, `$server/$folder/$file/$ai/triggers/on_save/$trigger/class.js`

### Сессия 16.07.2026 — переименование $work, панель управления, function calling

- **`$work` → `work`** — переименование во избежание конфликта с `tilde`-маршрутизацией
- **`data.logs` перехват** в `$class.save_file` — логи всегда в `meta_folder/logs/`
- **`slave` — базовая роль** — всегда добавляется в `roles()` для залогиненного пользователя
- **Селектор ролей в форме** — динамическое переключение (без `location.assign`), активное представление первым
- **Панель управления микрочата** — одна кнопка + (X), тег `<action>` управляется ИИ
- **SYSTEM_PROMPT обновлён** — секция `<action>`, убраны обратные кавычки из template literal
- **Function calling** — `buildFunctionsFromSchema()` + `prompt` передаёт `functions` в `streamChat` (код готов, не протестирован)
- **Микрочат `.thread`** — убран `column-reverse`, нормальное направление текста

**Изменённые файлы:**
- `sources/server/class.js` — `get_storage`, `resolveZone`, `roles`, `save_file`
- `sources/server/file.js` — восстановлен к оригиналу
- `sources/modules/ai-schema.js` — `buildFunctionsFromSchema()`
- `$server/$folder/handlers/pages/form/$handler/class.js` — динамическое переключение, `activeRole`
- `$server/$folder/$file/$ai/handlers/preview/$handler/class.js` — панель управления, `actionButton`, `.thread`
- `$server/$folder/$file/$ai/triggers/on_save/$trigger/class.js` — SYSTEM_PROMPT с `<action>`
- `$server/$folder/$file/$ai/methods/prompt/$method/class.js` — function calling цикл

## Незавершённое

### 1. ✅ Починить клиентский стриминг (ЗАВЕРШЕНО 13.07.2026)
### 2. ✅ Harness система — сквозной ИИ-агент (ЗАВЕРШЕНО 11.07.2026)

### Развитие ИИ-агента — 13.07.2026
- **Шаг 1: Навигация** — `navigate(path)` для прямого перехода по пути + авто `get_schema`
- **Шаг 2: Работа с файлами** — `read_file(name)`, `write_file(name, content)` как обёртки для ИИ
- **Шаг 2.1: UI** — служебные сообщения (tool_call, tool_result) скрыты в сворачиваемый блок `<details>`
- **Шаг 2.2: UI** — карточка файла (chat-item) для `write_file` через `resultPath`
- **Шаг 3: Микрофон** — запись голоса + распознавание речи (SpeechRecognition, ru-RU)
- **Шаг 4: Внешние файлы** — выбор через `ODA.showFileDialog`, превью-чипы
- **Шаг 5: Внутренние файлы** — выбор через `item-tree` dropdown, путь добавляется в промпт
- **Шаг 6: Действия ИИ в логах** — `write_file` использует `aiUser` (sender = имя модели)
- **Цикл tool-call** в `prompt` method: парсит `<tool_call>...`} блоки, выполняет через `execItemMethod`, итерации до 10
- **Загрузка `.mem`** — файлы памяти класса-агента в системный промт
- **Расширенный SYSTEM_PROMPT** — описание инструментов: info, load, save_file, find_text, get_schema, logs, search, create, delete
- **UI: навигатор + мессенджер** — item-tree слева, tool_result визуализация с 🔧
- **Принцип:** любой `$class` — агент, tools — его существующие методы, модели — per-task
### Очистка SYSTEM_PROMPT и упрощение <action> — 16.07.2026 (продолжение)
- **Удалено ~115 строк** из SYSTEM_PROMPT: секции с описанием инструментов, навигации, создания элементов
- **Причина:** инструменты передаются через functions (function calling), дублирование в промпте лишнее
- **Тег <action>** упрощён: только вопросы да/нет (убраны accept_plan, accept_result, continue)
- **Клиент:** onAction() отправляет «Да», onCancelAction() — «Нет»

**Изменённые файлы:**
- `\$server/\$folder/\$file/\$ai/triggers/on_save/\$trigger/class.js` — SYSTEM_PROMPT (327→212 строк)
- `\$server/\$folder/\$file/\$ai/handlers/preview/\$handler/class.js` — onAction(), onCancelAction()

### ИИ-инфраструктура — web_search, геолокация, functionCalling, модели — 16.07.2026 (вечер)
- **SYSTEM_PROMPT** — удалено дублирование инструментов, упрощён <action>, убран Plan/Act
- **web_search** — новый метод $ai (DuckDuckGo + Wikipedia), IP-геолокация для локальных запросов
- **functionCalling** — свойство модели (Boolean), не хардкод провайдеров; z.ai=true, GigaChat=false
- **trustLevel** — поле в METADATA (подготовка шкалы доверия 0-5)
- **streamChat** — Math.min max_tokens(131072), пропуск functions для моделей без functionCalling
- **z.ai/GLM-5.2** — настроен и работает (baseUrl, apiKey, maxTokens=131072)
- **Клиент** — прокрутка (_autoFollow, пульсация), -invert кнопки, $saveKey, ошибки сети
- **УТЕРЯНО:** SAFE_METHODS/isDangerousMethod — серверный перехват опасных методов нужно восстановить

### 3. Удалить мусор `models/G`
### 4. Дальнейшее развитие фреймворка ODA
- Удалить `utils.js` (мёртвый файл)
- Исправить систему слотов (renderChildren)
- Покрытие тестами Reactor
- Недостающие компоненты форм (input, select, date-picker и др.)
