# $task — хранитель длинной ИИ-сессии (ai.task)

## 1. Что это

Тип `$task` — **JSON-носитель** длинного диалога/PDCA (`ai.task`): `type: 'task'` + `items` (+ `todo`, `mode`, `system`, `model`).  
Способность ИИ (оркестратор, agents, `prompt`) живёт на **`$structure/ai/`**, не в этом типе файла.

Расширение `.task`. `contentType: 'application/json'`.

## 2. Зачем это нужно

Сохранить ленту, todo, модель и history между заходами; UI preview. Короткий вызов между классами — без файла: `/BASE?prompt&agent=web&prompt=…`.

## 3. Как это работает

1. **`class.js`** — тонкий фасад: `prompt` / `stop` / `change_*` / `pipe` / `body` → [`ai/harness.js`](/$server/$folder/$class/$structure/ai/harness.js/~/handlers/pages/form/) с `owner = $owner`, `file = this`.
2. **`on_save`** пишет `body.system` (профиль/группа/роль/локация) и вызывает `file.prompt` (делегат в harness).
3. **Pipe** грузится из `owner~/ai` (`task.js` + `agents/`), не из tilde файла.
4. Контракт блоков/агентов — см. [`$structure/ai/readme.md`](/$server/$folder/$class/$structure/ai/readme.md/~/handlers/pages/form/).
5. UI: `parseFormHtml` / `unwrapFence` из [`ai/task.js`](/$server/$folder/$class/$structure/ai/task.js/~/handlers/pages/form/).

## 4. Из чего это состоит

- [`class.js`](class.js) — фасад хранителя
- [`triggers/on_save/`](triggers/on_save/$trigger/class.js) — system + первый prompt
- [`handlers/`](handlers/) — preview микрочата
- [`readme.md`](readme.md) / [`progress.md`](progress.md)

## 5. Состояние

- ✅ Делегат в `$structure/ai/`; файл только persistence + UI
- ✅ One-shot на структуре: `?prompt&agent=&prompt=`
