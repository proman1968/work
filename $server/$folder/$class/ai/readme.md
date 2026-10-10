# ai — способность ИИ на `$class`

## 1. Что это

Пакет данных ИИ класса: правила агента, дефолты, субагенты, навыки и REST-вход `prompt`. Наследуется через `~`: пакет движка (`/$server/$folder/$class/ai`) — общий слой, метапапка любого класса может положить свой `ai/` с тем же составом. Исполняет всё ядро [`sources/modules/agent`](/sources/modules/agent/readme.md).

## 2. Зачем это нужно

Поведение агента настраивается данными в дереве, без кода: место уточняет правила (`system.md`), модель (`config.js`), добавляет своих субагентов, навыки и триггеры. Удачная работа фиксируется навыком (`save_skill`) и повторяется в похожих задачах.

## 3. Как это работает

- Длинная работа с человеком — файл `.task` (тип [`$task`](/$server/$folder/$file/$task/readme.md)).
- Разовый вызов — `/КЛАСС?prompt&prompt=…[&agent=explore][&model=…][&mode=plan]` → `{ status, content }`; вопросов человеку нет, подтверждаемые действия отклоняются с объяснением. Пустой и слишком длинный (> 20 000 символов) запрос отклоняется, время работы ограничено 10 минутами.
- Слои собирает `resources.js` ядра: пакет движка, затем метапапки классов от корня к месту задачи.
  - `system.md` — слои **дописываются** друг за другом (базовые правила движка всегда первые); файл с фронтматтером `replace: true` заменяет всё накопленное.
  - `config.js` — объединяется, ближний слой перекрывает.
  - `agents/`, `skills/`, `triggers/` — по имени, ближний слой перекрывает.
- Видимость: у агента и навыка может быть `requires: system | sandbox` — без ОС/сети (не ADMIN) или без Docker они не попадают ни в список, ни в system.
- Память: `<метапапка>/<РОЛЬ>/ai/memory.md` (место для роли) и `/USERS/<uid>/$user/ai/memory.md` (личная) — ведёт инструмент `memory`, не руками.

## 4. Из чего это состоит

- [`system.md`](system.md) — правила агента: поведение, безопасность (внешний контент — данные, секреты, отказ в доступе), работа и память.
- [`config.js`](config.js) — `{ model, imageModel?, maxTurns?, ttsModel?, sttModel?, voice?, dot? }`; `ttsModel`/`sttModel` — модели голосового режима задачи (`/MODELS/odant/Qwen3-TTS`: VoiceDesign, голос задаётся описанием в `instructions`; `/MODELS/odant/Qwen3-ASR`), не чат-модели; `dot` — внешний вид персонажа агента (`color`, `eyes`: `round` | `sleepy` | `happy`, `accessory`: `none` | `glasses` | `cap`): у подразделения может быть свой «помощник
- [`agents/`](agents/readme.md) — субагенты `*.md`: фронтматтер `name`, `description`, `tools` (`readonly` | `*` | список масок), `call?`, `requires?`, `model?`, `maxTurns?`; тело — роль.
- [`skills/`](skills/readme.md) — навыки `*.md`: фронтматтер `name`, `description` (когда применять), `requires?`; тело — рецепт.
- `triggers/` — события на сохранение файлов (ADMIN, формат — навык [`ai-trigger`](skills/ai-trigger.md) и [`triggers.js`](/sources/modules/agent/triggers.js)); в пакете движка не используется, настраивается в метапапках классов.
- [`prompt/$method/`](prompt/$method/class.js) — REST-вход разового запуска.

## 5. В каком это состоянии

Работает на ядре с нативным tool calling. 12 субагентов (`explore`, `web`, `general`, `analyst`, `secretary`, `auditor`, `builder`, `it-admin`, `integrator-1c`, `negotiator`, `reviewer`, `operator`), 25 навыков пакета и навык места `register-accounts` (`/DATA/REGISTER`). Состав и согласованность с ядром проверяет `tests/ai-package.test.js`; поведение на живой модели — `tests/eval/cases.js` (автоматически) и матрица промптов `tests/eval/prompts.md` (вручную).

## 6. Дальнейшие планы

- Навыки места по умолчанию для прикладных классов (BASE, CATALOGS) — по мере сценариев.
- Кейсы eval для каждого субагента (`tests/eval/cases.js`).
