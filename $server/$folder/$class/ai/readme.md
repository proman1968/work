# ai — способность ИИ на `$class`

## Что это

Пакет ИИ класса (не подтип `$ai`): агенты-боксы, вход `prompt`. Наследуется через tilde (`~/ai`).

## Состав

- [`system.md`](system.md) — базовый system (tilde)
- [`config.js`](config.js) — дефолты ИИ класса (`model`), tilde-наследование, потомки переопределяют
- [`task.js`](task.js) — оркестратор (`moves` + `tools`) для pipe
- [`agents/`](agents/) — агенты: декларации (system/prompt/tools/`nested`/init, опционально строгая `model`); контракт init — `{ block, box, messages, session, agent, live, exec, streamChat, engine, callAgent }`; `init === false` — нечего делать (tool снимается с `items`, тип в `using_blocks`; агент — `skip`); `nested` — кого можно вызвать через `callAgent(id, brief)` (поручение в brief, итог `{ ok, content, error }`); **исполняется этот пакет** (`loadAgent` / `_aiPackage`), не meta пира и не копия в USER без смены загрузки
- [`skills/`](skills/) — рецепты ленты (`id.js`): `when`, `points`, `slots`, `defaults`, `pipe`; `$task` грузит, выбирает на новой цели, надевает `pipe`
- [`prompt/$method/`](prompt/$method/class.js) — **движок**: system от заказчика сохраняется и дополняется (место / agent.system в fill); без system — `buildSystemPrompt`; стрим, стопы через `live.wait` (`stop` на блоке не снимать); tool: push → save → init (`init===false` → pop → save); вложенный агент — `callAgent` (brief → prompt ребёнка, лифт итога в поток родителя); **ok `create` в боксе → сразу `total`** (не pick write); **принятая activation / `write.need=create` → `nextIds` только `create`** (тип сожжён — всё равно); **activation в меню после ok `read`**; ошибка агента → `finish` (work: `mode` обратно в plan)

### Роли агентов

| Агент | Работа |
|--------|--------|
| [`explore`](agents/explore.js) | строение дерева: карта `/`; ls `deep=2`; readme; meta; **remote** (`list_remote` у узла); ask; путь с карты — имя папки/label |
| [`work`](agents/work.js) | файлы/классы: typed (`$file` when+METADATA); write путь `/…` (ошибка на блоке, не throw); create (родитель, тип, id, class.js); search в plan; build без search; activation после ok read; после APPROVE — create (и после ошибки create). Закон места — в readme узла |
| [`check`](agents/check.js) | постусловие create/write: exist + class.js + **readme в storage** (непустой); write картинки — байты, не OCR; **content-сводка закрывает бокс** (дети ignore); write без актуального readme — gap |
| [`web`](agents/web.js) | внешний интернет; `sites` из нитки или поиска; спрашивает [`site`](agents/site.js); один ребёнок с `content` — лифт, без второго fill; иначе сводка из draft+content |
| [`site`](agents/site.js) | fetch → `draft`; лист без `content`; узел — `pages` из href и `content` из draft детей; подъём — оба поля; не в меню корня |
| [`logs`](agents/logs.js) | журнал класса: `$class.logs` (даты, bodies+день+ext, entry); не work.read history |
| [`image`](agents/image.js) | картинка: `generateImage` (capabilities image) → файл в work; путь модели из ленты; N кадров — N generate |
| [`freeze`](agents/freeze.js) | после удачи: лента → `ai/skills/{id}.js` (draft → confirm → write); `step: false`; не в `pipe` навыка |
| [`review`](agents/review.js) | разбор этой ленты: схема `task.body` → закон + слой + `path`; не пишет файлы; `@review`; `step: false`; не в `pipe` навыка |

Сложные агенты (`explore`, `work`, `web`, `site`, `logs`, `planning`, `review`) и ход `thinking` — `allowReasoning: true` (CoT при `effort` бара ≠ off). Простые (`answer`, `question`, …) — без флага.

## Вызов

### Класс как сервер

Каждый класс — виртуальный сервер: обнаруживается через `~/ai` точки, вызывается только через её метод `prompt` с `context` + поручением, возвращает `{ ok, content, error }`. Агенты точки — её инструменты. Процесс абстрактный: оркестрация не знает ни задачу, ни устройство точек; устройство точки — только её `readme.md`; управление — только через API сервера.

`/BASE?prompt&prompt=привет&model=…` → standalone: `buildSystemPrompt` = `ai/system.md` (или пакет) + **`storage_folder/readme.md` места** + place/time; тихо (события с path класса), блок в ответе.

`/BASE?prompt&agent=web&prompt=погода` → агент; стоп-блок возвращается как есть (без `live.wait`). Модель: `agent.model` (строгая привязка) → `model` из вызова → `config.js` класса; нет нигде — ошибка. Класс исполнения — `this.$context` метода.

От живой ленты (`$file/$task`): владелец передаёт `live` + `messages` (handoff: свой `system` + диалог-улики) + `block`. Движок не затирает system заказчика — дописывает место исполнения и `agent`/`tool.system` на ходе (`fill`). Нет system — standalone `buildSystemPrompt`. `buildSystemPrompt` — тот же `$method` (для `on_save`). Вложенный ход: родитель `callAgent(id, brief)` — ребёнок получает поручение, родитель встраивает `{ ok, content, error }`.

### Peer-класс (explore `ask`)

Агент [`explore`](agents/explore.js) tool **`ask`**: путь `$class` + вопрос → `target.prompt({ prompt, agent: 'answer' })`. Агенты — пакет `~/ai/prompt` этого класса. `live` без `wait`. Последовательно.

### Журнал (logs)

Агент [`logs`](agents/logs.js): путь `$class` (или place исполнения) → `dates` → `bodies` за день (peek title/prompt, `file:` артефакт + `entry:` stub) → `entry` (`read_log_entry` по stub или `row.path` + дайджест связанного `.task`). Без write, без work.read history.
