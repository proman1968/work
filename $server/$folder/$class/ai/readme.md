# ai — способность ИИ на `$class`

## Что это

Пакет ИИ класса (не подтип `$ai`): агенты-боксы, вход `prompt`. Наследуется через tilde (`~/ai`).

## Состав

- [`system.md`](system.md) — базовый system (tilde)
- [`config.js`](config.js) — дефолты ИИ класса (`model`), tilde-наследование, потомки переопределяют
- [`task.js`](task.js) — оркестратор (`moves` + `tools`) для pipe
- [`agents/`](agents/) — агенты: декларации (system/prompt/tools/init, опционально строгая `model`); контракт init — `{ block, box, messages, session, agent, live, exec, streamChat }`
- [`prompt/$method/`](prompt/$method/class.js) — **движок**: system от заказчика сохраняется и дополняется (место / agent.system в fill); без system — `buildSystemPrompt`; стрим, стопы через `live.wait`

## Вызов

`/BASE?prompt&prompt=привет&model=…` → standalone: движок строит system из `system.md ~` и работает тихо (события с path класса), блок в ответе.

`/BASE?prompt&agent=web&prompt=погода` → агент; стоп-блок возвращается как есть (без `live.wait`). Модель: `agent.model` (строгая привязка) → `model` из вызова → `config.js` класса; нет нигде — ошибка. Класс исполнения — `this.$context` метода.

От живой ленты (`$file/$task`): владелец передаёт `live` + `messages` (handoff: свой `system` + диалог-улики) + `block`. Движок не затирает system заказчика — дописывает место исполнения и `agent`/`tool.system` на ходе (`fill`). Нет system — standalone `buildSystemPrompt`. `buildSystemPrompt` — тот же `$method` (для `on_save`).
