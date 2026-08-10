# Прогресс: $task / ai.task

## Последние изменения
- [10:02] Panel: убраны мёртвые `fire('chat.resume'|'chat.stop')` — в протоколе нет; stop только `fetch('stop')`. Readme обновлён.

## В работе
- Дерево решений pipe: валидация `choice`, auto-add `complete`.
- JSON-типы без `class.js` — `contentType` при появлении типизатора.
- Usage dial — при желании вынести в отдельный ODA-компонент.

## Ключевые решения
- MIME — поле типизатора, приоритетнее системного mime.
- Shell владеет `focusedBlock`; panel/ribbon — потребители.
- `ai.task` всегда с `model`; UI не гидратит MODELS.
- Chat-события WS: `delta` / `done` / `error` / `clear_stream` — не `resume`/`stop` через fire.

## Блокеры / Открытые вопросы
- FC отложен.
- Старые `*.ai` / `task.ai` не мигрированы.
