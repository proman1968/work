# ai — способность ИИ на `$class`

## Что это

Пакет ИИ класса (не подтип `$ai`): агенты-боксы, вход `prompt`. Наследуется через tilde (`~/ai`).

## Состав

- [`system.md`](system.md) — базовый system (tilde)
- [`task.js`](task.js) — оркестратор (`moves` + `tools`) для pipe
- [`agents/`](agents/) — агенты: декларации (system/prompt/tools/init, опционально строгая `model`); контракт init — `{ block, box, messages, session, agent, live, exec, streamChat }`
- [`prompt/$method/`](prompt/$method/class.js) — **движок**: system (пересобирается исполнителем), runtime, стрим (effort/maxOutput/usage/reasoning), стопы через `live.wait`

## Вызов

`/BASE?prompt&prompt=привет&model=…` → standalone: движок строит system из `system.md ~` и работает тихо (события с path класса), блок в ответе.

`/BASE?prompt&agent=web&prompt=погода` → агент; стоп-блок возвращается как есть (без `live.wait`). Модель: `agent.model` побеждает приехавшую (`agent.model ?? model`).

От живой ленты (`$file/$task`): владелец передаёт `live` (send/save/stopped/mode/wait) + `messages` (диалог-улики, handoff) + `block` из своей ленты — движок мутирует блок на месте, персист и события у владельца. Длинные сессии — `.task`. `buildSystemPrompt` — из того же `$method` (для `on_save`).
