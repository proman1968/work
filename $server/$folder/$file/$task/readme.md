# $task — длинная ИИ-сессия (ai.task)

## 1. Что это

Тип `$task` — JSON-носитель длинного диалога/PDCA (`ai.task`): `type: 'task'` + `items` (+ `todo`, `mode`, `system`, `model`) и **session-`prompt`** на самом типе файла.

Расширение `.task`. `contentType: 'application/json'`.

## 2. Зачем это нужно

Сохранить ленту, todo, модель и history между заходами; UI preview. Короткий one-shot между классами без файла — [`$class/ai`](/$server/$folder/$class/ai/readme.md/~/handlers/pages/form/) (`?prompt`).

## 3. Как это работает

1. **`class.js`** — session harness на типе: `prompt` / `stop` / `change_*` / `remove_block` / `pipe` / `body` / `model`.
2. **`pipe`** грузится из tilde файла: `task.js` + `agents/*` (не из `~/ai`).
3. **`on_save`** пишет `body.system` (`buildSystemPrompt` из [`prompt/$method`](/$server/$folder/$class/ai/prompt/$method/class.js/~/handlers/pages/form/)) и вызывает `file.prompt`.
4. UI: `parseFormHtml` / `unwrapFence` из локального [`task.js`](task.js).

## 4. Из чего это состоит

- [`class.js`](class.js) — session prompt и оркестратор
- [`task.js`](task.js) — оркестратор (`tools` / ходы) + хелперы UI
- [`agents/`](agents/) — субагенты (web, work, html, form, question)
- [`triggers/on_save/`](triggers/on_save/$trigger/class.js) — system + первый prompt
- [`handlers/`](handlers/) — preview микрочата
- [`readme.md`](readme.md) / [`progress.md`](progress.md)

## 5. Состояние

- ✅ Session-`prompt` на `$task/class.js` (pipe из локального tilde)
- ✅ One-shot на `$class/ai`: `/BASE?prompt&agent=&prompt=`

## 6. Дальнейшие планы

- Синхронизировать `task.js`/`agents` с `$class/ai` (moves vs tools, planning/report), если нужен один канон.
