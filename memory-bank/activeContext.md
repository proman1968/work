# Текущий контекст работы

## ✅ ИИ-инфраструктура — рабочее состояние (13.07.2026)

### Что работает
- **Harness-цикл tool-call** — ИИ вызывает методы/свойства контекста через `<tool_call>` блоки
- **Стриминг ответов** — токены GigaChat передаются через WS `chat.delta` в реальном времени
- **Повторные промпты в микрочате** (task.ai) — работают
- **Выбор модели** — dropdown с деревом
- **on_save триггер** — запускает prompt при создании task.ai
- **Загрузка .mem файлов** — долговременная память

### Ключевые архитектурные решения

1. **Модель передаётся через `params.$ai`** (не через `this`)
   - Reactor bound-функция игнорирует `.call()` — `this` в `execute` остаётся handler'ом
   - Решение: `prompt.execute` передаёт `{$ai: model}` в `execItemMethod`
   - `streamChat.execute` принимает: `const ai = params.$ai || this`

2. **WS-сообщения используют `taskAi.short`** (короткий путь с `~`)
   - Клиент хранит элементы в `CORE.$item.ITEMS` по short-пути
   - Серверный `item.path` — полный (с `$`), `item.short` — короткий (с `~`)
   - Все `WORK.wsSend({path: ...})` используют `wsPath = taskAi.short`

### Структура файлов ИИ
- `models/$ai/` — корневой тип
- `models/GigaChat Pro/$ai/data.js` — конфигурация модели (baseUrl, token, protocol)
- `models/$ai/$folder/$storage/$ai/methods/streamChat/$method/data.js` — стриминг
- `$server/$folder/$file/$ai/methods/prompt/$method/data.js` — harness-цикл
- `$server/$folder/$file/$ai/triggers/on_save/$trigger/data.js` — SYSTEM_PROMPT
- `$server/$folder/$file/$ai/handlers/preview/$handler/data.js` — UI микрочата

### Следующие шаги
- Удалить мусор `models/G`
- Развитие ODA-фреймворка (слоты, компоненты форм)
- RAG-поиск перед промптом