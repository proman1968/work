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
- Шаг 4: Планирование ИИ (Chain-of-thought) — ИИ сначала составляет план, потом выполняет
- Шаг 5: Function calling API (вместо парсинга текста)
- Шаг 6: Управление контекстом диалога
- Шаг 7: RAG-поиск перед промптом
- Развитие ODA-фреймворка (слоты, компоненты форм)

### Bugfix: buildAiSchema — обход цепочки прототипов (14.07.2026)
- **Баг:** `?get_schema` не показывал `@ai` метаданные для `$storage`/`$file`
- **Причина:** `Object.getOwnPropertyNames(proto)` возвращает методы только собственного прототипа, не унаследованные от `$folder`
- **Решение:** `buildAiSchema` обходит всю цепочку через `Object.getPrototypeOf()` до `Object.prototype`
- Для каждого слоя парсит свой `constructor.sourceUrl` и `TOOL_DESCRIPTIONS`
- Методы нижних слоёв не дублируются (контролируется через `seenNames`)

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
