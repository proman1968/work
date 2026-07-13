# Текущий контекст работы

## ✅ ИИ-инфраструктура — рабочее состояние (13.07.2026)

### Что работает
- **Harness-цикл tool-call** — ИИ вызывает методы/свойства контекста через `<tool_call>` блоки
- **Стриминг ответов** — токены GigaChat передаются через WS `chat.delta` в реальном времени
- **Повторные промпты в микрочате** (task.ai) — работают
- **Выбор модели** — dropdown с деревом
- **on_save триггер** — запускает prompt при создании task.ai
- **Загрузка .mem файлов** — долговременная память
- **Навигация** — `navigate(path)` + авто `get_schema`
- **Работа с файлами** — `read_file`, `write_file` как обёртки для ИИ
- **Микрофон** — запись голоса + распознавание речи (SpeechRecognition)
- **Внешние файлы** — выбор через `ODA.showFileDialog`, превью-чипы
- **Внутренние файлы** — выбор через `item-tree` dropdown
- **Голосовой режим** — TTS (SpeechSynthesis) + непрерывный диалог
- **Действия ИИ в логах** — метятся моделью (sender = имя модели)

### Ключевые архитектурные решения

1. **Модель передаётся через `params.$ai`** (не через `this`)
   - Reactor bound-функция игнорирует `.call()` — `this` в `execute` остаётся handler'ом
   - Решение: `prompt.execute` передаёт `{$ai: model}` в `execItemMethod`

2. **WS-сообщения используют `taskAi.short`** (короткий путь с `~`)
   - Клиент хранит элементы в `CORE.$item.ITEMS` по short-пути

3. **Действия ИИ используют `aiUser`** — sender в логах = имя модели

### Структура файлов ИИ
- `models/$ai/` — корневой тип
- `models/GigaChat Pro/$ai/data.js` — конфигурация модели
- `models/$ai/$folder/$storage/$ai/methods/streamChat/$method/data.js` — стриминг
- `$server/$folder/$file/$ai/methods/prompt/$method/data.js` — harness-цикл
- `$server/$folder/$file/$ai/triggers/on_save/$trigger/data.js` — SYSTEM_PROMPT
- `$server/$folder/$file/$ai/handlers/preview/$handler/data.js` — UI микрочата

### Следующие шаги
- Шаг 3: ✅ Универсальная разметка методов через JSDoc `@ai` + парсинг исходников (14.07.2026)
- Шаг 4: ✅ Планирование ИИ (Chain-of-thought) + режим Plan/Act (14.07.2026)
- Шаг 5: Function calling API (вместо парсинга текста)
- Шаг 6: Управление контекстом диалога
- Шаг 7: RAG-поиск перед промптом
- Развитие ODA-фреймворка (слоты, компоненты форм)

### Plan/Act режим + Chain-of-thought + вопросы (14.07.2026)
- **Режим Plan (диалог)** — по умолчанию. Разрешено только чтение и навигация.
- **Режим Act (выполнение)** — включается кнопкой `run` в UI. Разрешены создание/изменение/удаление.
- **`SAFE_METHODS`** — список безопасных методов (get_schema, read_file, navigate и др.)
- **`isDangerousMethod(method)`** — проверка: требует ли метод режим Act
- **`parsePlan(text)`** — извлечение `<plan>[...]</plan>` из ответа ИИ
- **План в контексте** — `body.plan` добавляется в system prompt через `buildHistoryFromChat`
- **Автосброс Act** — после выполнения действий `act` сбрасывается в UI
- **WS-события** — `chat.ready_to_act`, `chat.plan`
- **Блок плана в UI** — `.plan-block` с иконками ⏳/🔄/✅ и прогрессом
- **Интерактивные вопросы** — ИИ использует `<questions>[...]</questions>`, UI рендерит поля ввода + кнопку «Ответить»
- **`answerQuestions(msgTime)`** — собирает ответы и отправляет как промпт

### Bugfix: buildAiSchema — обход цепочки прототипов (14.07.2026)
- **Баг:** `?get_schema` не показывал `@ai` метаданные для `$storage`/`$file`
- **Причина:** `Object.getOwnPropertyNames(proto)` возвращает методы только собственного прототипа, не унаследованные от `$folder`
- **Решение:** `buildAiSchema` обходит всю цепочку через `Object.getPrototypeOf()` до `Object.prototype`
- Для каждого слоя парсит свой `constructor.sourceUrl` и `TOOL_DESCRIPTIONS`
- Методы нижних слоёв не дублируются (контролируется через `seenNames`)

### readme.md в контексте ИИ + автообновление (14.07.2026)
- **Загрузка readme.md** при запуске чата — `loadReadme(storage)` в `prompt/$method/data.js`
- readme.md из метапапки хранилища добавляется в system prompt
- **SYSTEM_PROMPT обновлён** — ИИ обязан поддерживать readme.md при значимых изменениях
- readme.md создаётся/обновляется через `write_file("readme.md", содержимое)`

### Умения строить систему (14.07.2026)
- SYSTEM_PROMPT расширен секцией «Создание элементов системы»
- ИИ умеет создавать: хранилища ($storage), методы ($method), триггеры ($trigger), обработчики ($handler), интерфейсы (pages/forms)
- Инструкции описывают структуру папок и примеры кода data.js

### JSDoc @ai-разметка методов (14.07.2026)
- **`sources/modules/ai-schema.js`** — `buildAiSchema(proto)` парсит исходный файл класса через `constructor.sourceUrl`
- Классы `$folder`, `$storage`, `$file` содержат `static sourceUrl = import.meta.url`
- Ключевые методы помечены JSDoc-тегами `@ai`, `@ai.params`, `@ai.returns`
- `TOOL_DESCRIPTIONS` — fallback для методов без `@ai` (наследуется через `...$folder.TOOL_DESCRIPTIONS`)
- `get_schema()` в `$folder` использует `buildAiSchema(this.constructor.prototype)`
- **Критическая находка**: `fn.toString()` НЕ сохраняет JSDoc-комментарии в V8 — поэтому парсим исходный файл напрямую
- Результат кэшируется в `WeakMap` по конструктору
