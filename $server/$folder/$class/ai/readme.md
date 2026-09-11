# ai — способность ИИ на `$class`

## Что это

Пакет ИИ класса (не подтип `$ai`): агенты-боксы, вход `prompt`. Наследуется через tilde (`~/ai`).

## Состав

- [`system.md`](system.md) — базовый system (tilde)
- [`config.js`](config.js) — дефолты ИИ класса (`model`), tilde-наследование, потомки переопределяют
- [`task.js`](task.js) — оркестратор (`moves` + `tools`) для pipe
- [`agents/`](agents/) — агенты: декларации (system/prompt/tools/`nested`/init, опционально строгая `model`); контракт init — `{ block, box, messages, session, agent, live, exec, streamChat, engine }`; `init === false` — нечего делать (tool снимается; агент — `skip`); `nested` — спросить агента, не tool; **исполняется этот пакет** (`loadAgent` / `_aiPackage`), не meta пира и не копия в USER без смены загрузки
- [`skills/`](skills/) — рецепты ленты (`id.js`): `when`, `points`, `slots`, `defaults`, `pipe`; `$task` грузит, выбирает на новой цели, надевает `pipe`
- [`prompt/$method/`](prompt/$method/class.js) — **движок**: system от заказчика сохраняется и дополняется (место / agent.system в fill); без system — `buildSystemPrompt`; стрим, стопы через `live.wait`

### Роли агентов

| Агент | Работа |
|--------|--------|
| [`explore`](agents/explore.js) | строение WORK: карта `/`; ls `deep=2`; readme; meta; **remote у `$provider`**; ask |
| [`work`](agents/work.js) | файлы/классы: **typed** (тип `$file` по `when` + `METADATA` → `save_file` на месте с `message`/`time`); перед правкой — readme; create/write устройства → обновить `storage_folder/readme.md`; create batch + артефакты `file`; search только в классе; картинка — image, не write png/svg; **expand** листьев в контекст (check targets) |
| [`check`](agents/check.js) | постусловие create/write: exist + class.js + **readme в storage** (непустой); write картинки — байты, не OCR; **content-сводка закрывает бокс** (дети ignore); write без актуального readme — gap |
| [`web`](agents/web.js) | внешний интернет; `sites` из нитки или поиска; спрашивает [`site`](agents/site.js); один ребёнок с `content` — лифт, без второго fill; иначе сводка из draft+content |
| [`site`](agents/site.js) | fetch → `draft`; лист без `content`; узел — `pages` из href и `content` из draft детей; подъём — оба поля; не в меню корня |
| [`logs`](agents/logs.js) | журнал класса: `$class.logs` (даты, bodies+день+ext, entry); не work.read history |
| [`image`](agents/image.js) | картинка: `$ai.generateImage` → файл в work; **N из запроса (картинка/фото/по сезонам) — N generate** (по файлу), не коллаж и не work.write; после save — `path` + `saved`; ошибка — стоп (`stopOnError`) |
| [`freeze`](agents/freeze.js) | после удачи: лента → `ai/skills/{id}.js` (draft → confirm → write); `step: false`; не в `pipe` навыка |
| [`review`](agents/review.js) | разбор этой ленты: схема `task.body` → закон + слой + `path`; не пишет файлы; `@review`; `step: false`; не в `pipe` навыка |

Сложные агенты (`explore`, `work`, `web`, `site`, `logs`, `planning`, `review`) и ход `thinking` — `allowReasoning: true` (CoT при `effort` бара ≠ off). Простые (`answer`, `question`, …) — без флага.

## Вызов

`/BASE?prompt&prompt=привет&model=…` → standalone: `buildSystemPrompt` = `ai/system.md` (или пакет) + **`storage_folder/readme.md` места** + place/time; тихо (события с path класса), блок в ответе.

`/BASE?prompt&agent=web&prompt=погода` → агент; стоп-блок возвращается как есть (без `live.wait`). Модель: `agent.model` (строгая привязка) → `model` из вызова → `config.js` класса; нет нигде — ошибка. Класс исполнения — `this.$context` метода.

От живой ленты (`$file/$task`): владелец передаёт `live` + `messages` (handoff: свой `system` + диалог-улики) + `block`. Движок не затирает system заказчика — дописывает место исполнения и `agent`/`tool.system` на ходе (`fill`). Нет system — standalone `buildSystemPrompt`. `buildSystemPrompt` — тот же `$method` (для `on_save`).

### Peer-класс (explore `ask`)

Агент [`explore`](agents/explore.js) tool **`ask`**: путь `$class` + вопрос → `Object.create(engine)` с `eng.$context = target` (движок вызывающего; peer без `~/ai`). Агенты — пакет движка; config/`system.md`/readme — meta target, иначе пакет. `live` без `wait`. Последовательно; parallel fan-out — следующий шаг.

### Журнал (logs)

Агент [`logs`](agents/logs.js): путь `$class` (или place исполнения) → `dates` → `bodies` за день (peek title/prompt, `file:` артефакт + `entry:` stub) → `entry` (`read_log_entry` по stub или `row.path` + дайджест связанного `.task`). Без write, без work.read history.
