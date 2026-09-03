# ai — способность ИИ на `$structure`

## Что это

Пакет ИИ рабочей структуры (не подтип `$ai`): оркестратор, агенты, вход `prompt`. Наследуется через tilde на инстансы `$base` / `$user` / `$group` / …

## Состав

- [`system.md`](system.md) — базовый system (tilde)
- [`harness.js`](harness.js) — **session harness**: pipe, лента, `.task`
- [`prompt.js`](prompt.js) — one-shot: `answerOnce` / `runAgent`, без `.task`
- [`task.js`](task.js) — оркестратор (`moves` + `tools`)
- [`agents/`](agents/) — субагенты (web, work, …)
- [`prompt/$method/`](prompt/$method/class.js) — HTTP: `?prompt` или `?prompt&agent=`

## Вызов

`/BASE?prompt&prompt=привет&model=…` → `{ ok, items: [prompt, answer], content }`

`/BASE?prompt&agent=web&prompt=погода` → `{ ok, agent, items, block, content }` — блоки готовы для `task.items.push(...)`.

Длинные сессии — файл `.task` (тип `$file/$task`): session harness, persistence, UI preview.
