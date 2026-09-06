# ai — способность ИИ на `$class`

## Что это

Пакет ИИ класса (не подтип `$ai`): агенты-боксы, вход `prompt`. Наследуется через tilde (`~/ai`).

## Состав

- [`system.md`](system.md) — базовый system (tilde)
- [`config.js`](config.js) — дефолты ИИ класса (`model`), tilde-наследование, потомки переопределяют
- [`task.js`](task.js) — оркестратор (`moves` + `tools`) для pipe
- [`agents/`](agents/) — агенты: декларации (system/prompt/tools/init, опционально строгая `model`); контракт init — `{ block, box, messages, session, agent, live, exec, streamChat, engine }`; грузит движок из своего пакета ai (не meta peer через ~)
- [`prompt/$method/`](prompt/$method/class.js) — **движок**: system от заказчика сохраняется и дополняется (место / agent.system в fill); без system — `buildSystemPrompt`; стрим, стопы через `live.wait`

### Роли агентов

| Агент | Работа |
|--------|--------|
| [`explore`](agents/explore.js) | строение WORK: карта `/` (1 уровень); **ls ветки = `info({ deep: -1 })`** до листьев; readme, ask |
| [`work`](agents/work.js) | файлы области: read/write; **search только внутри выбранного класса** (не корень WORK) |
| [`web`](agents/web.js) | внешний интернет |
| [`logs`](agents/logs.js) | журнал класса: `$class.logs` (даты, bodies+день+ext, entry); не work.read history |

Сложные агенты (`explore`, `work`, `web`, `logs`, `planning`) и ход `thinking` — `allowReasoning: true` (CoT при `effort` бара ≠ off). Простые (`answer`, `question`, …) — без флага.

## Вызов

`/BASE?prompt&prompt=привет&model=…` → standalone: движок строит system из `system.md ~` и работает тихо (события с path класса), блок в ответе.

`/BASE?prompt&agent=web&prompt=погода` → агент; стоп-блок возвращается как есть (без `live.wait`). Модель: `agent.model` (строгая привязка) → `model` из вызова → `config.js` класса; нет нигде — ошибка. Класс исполнения — `this.$context` метода.

От живой ленты (`$file/$task`): владелец передаёт `live` + `messages` (handoff: свой `system` + диалог-улики) + `block`. Движок не затирает system заказчика — дописывает место исполнения и `agent`/`tool.system` на ходе (`fill`). Нет system — standalone `buildSystemPrompt`. `buildSystemPrompt` — тот же `$method` (для `on_save`).

### Peer-класс (explore `ask`)

Агент [`explore`](agents/explore.js) tool **`ask`**: путь `$class` + вопрос → `Object.create(engine)` с `eng.$context = target` (движок вызывающего; peer без `~/ai`). Агенты — пакет движка; config/system — meta target, иначе пакет. `live` без `wait`. Последовательно; parallel fan-out — следующий шаг.

### Журнал (logs)

Агент [`logs`](agents/logs.js): путь `$class` (или place исполнения) → `dates` → `bodies` за день → при необходимости `entry` (`read_log_entry`). Без write.
