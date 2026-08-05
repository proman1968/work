# Прогресс: $task / ai.task

## Последние изменения

- [18:45] **Preview polish + канон.** `focusedBlock` на shell; panel через `$pdp` (без tip/findFirstModel); `$pdp`→`Reactor.get` в oda.js; геттеры без `|| null`; `viewTag` без `customElements.get`; scroll = ResizeObserver. Rules: B.1.1–B.1.3.
- [17:22] **Preview layout.** UI-модули в `$handler/ui/`; у корня только `class.js` + `readme.md`.
- [17:20] **Panel split.** `mic.js` / `tts.js` / `usage.js` вынесены из `panel.js`.
- [17:11] **Эталон shell preview.** Зафиксировано в `rules/rules.md` B.1.1.
- [16:40] **Переименование.** `$file/$ai` → `$file/$task`, `task.ai` → `ai.task`.
- [16:06] **`contentType`** типизатора; http-server: тип выше mime.

## В работе

- Дерево решений pipe: валидация `choice`, auto-add `complete`.
- JSON-типы без `class.js` — `contentType` при появлении типизатора.
- Usage dial — при желании вынести в отдельный ODA-компонент.

## Ключевые решения

- MIME — поле типизатора, приоритетнее системного mime.
- Shell владеет `focusedBlock`; panel/ribbon — потребители.
- `ai.task` всегда с `model`; UI не гидратит MODELS.
- Имя `$task` (файл) ≠ `$handler/$task` (cron) ≠ `MODELS/$ai`.

## Блокеры / Открытые вопросы

- FC отложен.
- Старые `*.ai` / `task.ai` не мигрированы.
