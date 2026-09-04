# ai — способность ИИ на `$class`

## Что это

Пакет ИИ класса (не подтип `$ai`): агенты-боксы, вход `prompt`. Наследуется через tilde (`~/ai`).

## Состав

- [`system.md`](system.md) — базовый system (tilde)
- [`task.js`](task.js) — оркестратор (`moves` + `tools`) для pipe
- [`agents/`](agents/) — агенты = box со своими шагами; опционально `model`
- [`prompt/$method/`](prompt/$method/class.js) — **весь** one-shot: system, runtime, answer / agent

## Вызов

`/BASE?prompt&prompt=привет&model=…` → нет `context` → новый body + system из `system.md` → answer → `{ ok, items, content, context }`

`/BASE?prompt&agent=web&prompt=погода&context=…` → грузит агент; развивает переданный `context` локально. Модель: `params.model` || `agent.model`.

Длинные сессии — `.task` (`$file/$task`). `buildSystemPrompt` экспортируется из того же `$method` (для `on_save`).
