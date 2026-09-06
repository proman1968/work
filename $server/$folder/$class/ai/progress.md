# Прогресс: $class/ai

## Последние изменения
- [02:30] logs: «вчера/сегодня» → ISO; bodies + `ext` (ics/eml/task); `entry:` вместо `file:`; thinking/work — журнал не через work.read. Причина: зонд «чем занимались» брал сегодня и уходил читать .logs файлами.
- [02:15] explore `ls` ветки: `info({ deep: -1 })` компактным деревом (path/type/label); корень `/` — по-прежнему один уровень. Причина: зонд моделей останавливался на провайдерах без листьев.
- [02:05] Слои WORK: thinking → explore для строения; `work.search` только внутри класса (путь+запрос, запрет корня); `allowReasoning` у сложных агентов/thinking; reactor Array без `[R]` не трогает deps (xenova). Причина: зонд «какие модели» ушёл в глобальный search и краш embedding.
- [01:45] work/explore/logs: динамический `label` бокса («Файлы: читаю /path», «Осмотр: ls /…», «Журнал: …»). Причина: в ленте было неясно, чем и где занят агент.
- [01:30] `explore` ORIENTATION: один ls = компас, не ответ; спуск/ask листьев; total только по items; без сценария «модели». Причина: зонд — пример; прогон остановился на провайдерах и выдумал ls глубже.
- [01:25] RAG: skip скрытых `.…`; TEXT_EXTS +`task`/`ai`/…; kreuzberg только whitelist (не ico/unknown) — тихий skip. Причина: warn `.task`, `.clineignore`, `image/x-icon`.
- [01:20] RAG: `exclude_for_rag` = `.git`/`node_modules`/`.cursor`/`.vscode`; `folder.rag` skip `isInherit`; extract — `real_dir` + `md` в TEXT_EXTS. Причина: warn embeddings на `.git` и призраках `$group/.../readme.md`.
- [01:15] Агент `logs`: dates / bodies / entry поверх `$class.logs` и `read_log_entry`; класс из пути или place (`engine.$context`). Read-only. Причина: хронология процессов и взаимодействий — отдельная роль от explore/work.
- [01:10] Агент `explore`: карта/ls/readme/ask + ORIENTATION вынесены из `work`. `work` — только файлы (search/read/write/activation). `web` → локальное WORK это explore. Причина: меню оркестратора стабильно отделяет осмотр площадки от записи файлов.
- [00:50] `loadAgent` — агенты из пакета `_aiPackage()` (parent метода с `agents/`), не `$context.meta_folder` через ~. ask: `Object.create(engine)` + `$context = target`; peer без ~/ai. `loadConfig`/`system.md` — meta target, иначе пакет движка. init получает `engine`. Причина: ask /MODELS — `importScript` of undefined (у peer нет ai/agents).
- [00:40] `work` tool `ask`: peer `$class` → `Object.create(prompt)` + свой `$context`; ответ в ленте; ORIENTATION — истина домена через ask. Parallel — следующий. Причина: класс сам отвечает за содержимое (зонд моделей), не имена папок.
- [00:20] `work` карта/ls: только `$class` + type/label/note/readme; контракт «ls → read readme»; read пути класса → `readme.md`. Причина: ориентация по канону WORK, не по мусору репо (.git/node_modules).
- [00:05] `work`: tool `ls`; `read`/`ls` без пути → `false` (повторный pick); путь с карты/`ROOT_HINTS`. Движок: `init===false` → снова `turn`, не `total`. `web` description — не для локального WORK. Причина: прогон моделей — пустой read валил work, уход в web.
- [23:40] `work`: легенда ориентации в system + `init` кладёт `[карта /]` (дети корня) в ленту и messages. Причина: агент должен ориентироваться в строении WORK осмотром, а не памятью/web (зонд «какие модели»).
- [19:16] `execute` не принимает `location`/`tz` (никогда); они только у `buildSystemPrompt` для `on_save`. Handoff несёт уже готовый `body.system`.
- [11:25] Убрана передача `owner` / `params.$context`: класс исполнения только `this.$context`. Причина: отдельный owner был лишним слоем; `$context` не переписывается.
- [15:20] Владелец исполнения — `params.$context` (ставит HTTP-диспетчер или таск), `this.$context` — фолбэк; `loadAgent`/`loadConfig`/`buildSystemPrompt` берут owner аргументом. Причина: прогон — падение `undefined (reading 'meta_folder')`: привязка `item.$context` разделяемая, её перебивает параллельный `_methods` другого элемента.
- [14:35] `prompt/$method` — единый движок агентов: контракт `live` (send/save/stopped/wait/mode) от владельца ленты; standalone REST — тихий live c path класса. Причина: одна реализация для one-shot и живой ленты $task.

## В работе
- Parallel fan-out `ask` по нескольким классам (тот же Object.create `$context`).

## Ключевые решения
- Решение: журнал только `$class.logs` / `read_log_entry` (день, ext); не work по history. Причина: иначе модель читает .logs как файлы и путает день.
- Решение: explore ls ветки — `info({ deep: -1 })` (не один уровень имён); карта `/` — компас. Причина: состав домена (модели под провайдерами) виден сразу, без серии ls/ask.
- Решение: work.search — путь класса + запрос, запрет корня WORK; строение площадки — explore. Причина: глобальный semantic_search ломает слои и роняет xenova/RAG.
- Решение: `allowReasoning` у сложных агентов; CoT только при effort бара ≠ off. Причина: гейт был, флаг не стоял.
- Решение: explore — глубина до фактов домена (ls/ask вниз); один уровень имён — компас; total без выдуманных шагов. Причина: любой доменный зонд (не только модели), иначе итог по контейнерам.
- Решение: RAG — `exclude_for_rag` + skip `isInherit`; extract по `real_dir` / text `md`. Причина: semantic_search по корню сыпал warn на `.git` и tilde-призраки `$group/.../readme.md`.
- Решение: explore — осмотр/ask; work — файлы; web — интернет; logs — журнал класса. Причина: одна работа на агента, стабильное меню.
- Решение: код агентов — пакет движка (`_aiPackage`); `$context` peer — место/домен; ~ у peer для ask не обязателен. Причина: ask чужого класса не должен требовать наследования `ai/agents`.
- Решение: кросс-класс — `ask` в explore, не подмена за чужой домен; `$context` через `Object.create`. Причина: каждый `$class` отвечает за своё содержимое.
- Решение: живость ленты — контракт `live` (null-object для REST), а не второй код-путь. Причина: один движок, персист и события принадлежат владельцу ленты.
- Решение: улики едут диалогом `messages` (handoff-проекция от заказчика), system — всегда локальный. Причина: место исполнения обязано давать свой `system.md ~`.

## Блокеры / Открытые вопросы
- Нет.
