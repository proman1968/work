# ai — способность ИИ на `$structure`

## Что это

Пакет ИИ рабочей структуры (не подтип `$ai`): оркестратор, агенты, вход `prompt`. Наследуется через tilde на инстансы `$base` / `$user` / `$group` / …

## Состав

- [`system.md`](system.md) — базовый system (tilde)
- [`harness.js`](harness.js) — runtime для one-shot (`createRuntime` / `answerOnce` / `runAgent`) + `buildSystemPrompt`
- [`prompt.js`](prompt.js) — one-shot: `answerOnce` / `runAgent`, без `.task`
- [`task.js`](task.js) — оркестратор (`moves` + `tools`) для one-shot pipe
- [`agents/`](agents/) — субагенты (web, work, …) для one-shot
- [`prompt/$method/`](prompt/$method/class.js) — HTTP: `?prompt` или `?prompt&agent=`

## Вызов

`/BASE?prompt&prompt=привет&model=…` → `{ ok, items: [prompt, answer], content }`

`/BASE?prompt&agent=web&prompt=погода` → `{ ok, agent, items, block, content }` — блоки готовы для `task.items.push(...)`.

Длинные сессии — файл `.task` (тип `$file/$task`): session-`prompt` на самом `$task/class.js`, persistence, UI preview. Этот пакет — one-shot и общий `buildSystemPrompt` / harness для вызовов без файла.
