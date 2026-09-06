# $task — длинная ИИ-сессия (ai.task)

## 1. Что это

Тип `$task` — JSON-носитель длинного диалога/PDCA (`ai.task`): `type: 'task'` + `items` (+ `todo`, `mode`, `system`, `model`) и **session-`prompt`** на самом типе файла.

Расширение `.task`. `contentType: 'application/json'`.

## 2. Зачем это нужно

Сохранить ленту, todo, модель и history между заходами; UI preview. Короткий one-shot между классами без файла — [`$class/ai`](/$server/$folder/$class/ai/readme.md/~/handlers/pages/form/) (`?prompt`).

## 3. Как это работает

1. **`class.js`** — session harness на типе: `prompt` / `stop` / `change_*` / `remove_block` / `pipe` / `body` / `model`.
2. **`pipe`**: `task.js` из tilde (ходы оркестратора) + декларации агентов из меты класса (`$class.meta_folder` → `ai/agents`, канон движка). Тёзки ходов оркестратора выше агентов.
3. **Агенты исполняет движок класса** ([`prompt/$method`](/$server/$folder/$class/ai/prompt/$method/class.js/~/handlers/pages/form/)): таск пушит блок и передаёт `live` + `context({handoff})` — `body.system` + диалог-улики (без topicsMap). Движок дополняет system локально (место, агент). Ответ человека — `_resolveWait` (APPROVE); обрыв — `_activeAgentBlock`.
4. **`on_save`** пишет `body.system` (`buildSystemPrompt` из `prompt/$method`) и вызывает `file.prompt`.
5. UI: `parseFormHtml` / `unwrapFence` из локального [`task.js`](task.js).

## 4. Из чего это состоит

- [`class.js`](class.js) — session prompt, оркестратор ленты, контракт `live` для движка агентов
- [`task.js`](task.js) — оркестратор (`tools` / ходы) + хелперы UI
- [`triggers/on_save/`](triggers/on_save/$trigger/class.js) — system + первый prompt
- [`handlers/`](handlers/) — preview микрочата
- [`readme.md`](readme.md) / [`progress.md`](progress.md)

## 5. Состояние

- ✅ Session-`prompt` на `$task/class.js`; агенты — движок `$class/ai` через `live`
- ✅ One-shot на `$class/ai`: `/BASE?prompt&agent=&prompt=`

## 6. Дальнейшие планы

- Свести собственные ходы таска (`_streamChat` / `_fillLeaf`) на движок `$class/ai`.
- Кросс-классовый запуск агентов (адресация чужого класса из процесса).
