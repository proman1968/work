# Прогресс: $task / ai.task

## Последние изменения

- [17:22] **Preview layout.** UI-модули в `$handler/ui/`; у корня только `class.js` + `readme.md`.
- [17:20] **Panel split.** `mic.js` / `tts.js` / `usage.js` вынесены из `panel.js`; panel = tip + composer + model + send/pending.
- [17:11] **Эталон shell preview.** `handlers/preview/$handler/class.js` — только `data`/`items`/`$item`, load по `changed`. Зафиксировано в `rules/rules.md` B.1.1.
- [16:40] **Переименование.** `$file/$ai` → `$file/$task`, расширение `.ai` → `.task`, канон файла `task.ai` → `ai.task`. Обход конфликта `mime-types` (`.ai` = PostScript).
- [16:06] **`contentType` типизатора файла.** `$task` (и `$bid`/`$product`/`$order`) объявляют `contentType: 'application/json'`. http-server: **тип `contentType` → иначе mime → иначе `text/plain`**. `$file.contentType` геттер из `DATA`. Preview `_load` = `await $item.load()` без Blob/JSON.parse; на `changed` только `body = undefined` + load.

## В работе

- Дерево решений pipe: валидация `choice`, условие auto-add `complete`.
- Остальные JSON-типы без `class.js` (`$skill`/…) — добавить `contentType` при появлении типизатора.

## Ключевые решения

- MIME кастомных расширений — поле типизатора `$ext/class.js`, приоритетнее системного mime.
- UI: shell абстрактен; pending в panel; tip = `value = label` → `send()`.
- Имя типа `$task` (файл) ≠ `$handler/$task` (cron) ≠ `MODELS/$ai` (модели).

## Блокеры / Открытые вопросы

- FC отложен.
- Старые пользовательские `*.ai` / `task.ai` не мигрированы.
