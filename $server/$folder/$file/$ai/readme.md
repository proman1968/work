# $ai — тип файла ИИ-задачи (task.ai)

## 1. Что это

Тип `$ai` — файловый носитель диалога и PDCA-цикла встроенного ИИ WORK (`task.ai`). Технически это JSON с `ribbon`, планом и контекстом; прикладно — панель управления задачей агента в зоне роли USER / BOSS / ADMIN.

**Видение:** агент уровня Cursor/Cline **на пайплайне WORK** (не IDE-host). Дорожная карта — §7.

## 2. Зачем это нужно

Даёт ИИ-управляющему единую точку: увидеть контекст пары user/class (readme, память, логи), спланировать работу, уточнить данные, вызвать tools в ACL роли и при ADMIN — нарастить класс через файлы с подтверждением. Вход в цикл — через `triggers/on_save`, не через host `file-handlers`.

## 3. Как это работает

1. Сохранение / обновление `task.ai` → [`triggers/on_save`](/$server/$folder/$file/$ai/triggers/on_save/$trigger/class.js/~/handlers/pages/form/) вызывает `taskFile.prompt(...)`.
2. **Два вида промптов, различаются ролью.** Реальный (role `USER|BOSS|ADMIN` — всегда приходит с клиента, default USER) пишется блоком `prompt` в ленту. Служебный (role `ASSISTENT` — самовызовы шагов плана и авто-ходов) подаётся **только на острие** messages текущего вызова модели: в ленту и в историю следующих ходов не попадает.
3. `prompt` — **инстанс-метод файла** (наследуется из `class.js` типизатора через merge-цепочку, `this` = файл `task.ai`). **Реальный text — двухтактный ход:** 1) messages = system + контекст пары + история ribbon (только факты); 2) блок `prompt` в активный ribbon (чистый текст, без инъекций); 3) **такт 1 «думай»**: на острие промпт + `TYPES.prompt.servicePrompt`, functions не передаются, весь ответ целиком = блок `thinking`; 4) **такт 2 «маршрутизация»**: ответ пользователю обычным текстом (→ `text`, wait, стоп) ЛИБО ровно одно слово `research | plan | task | do | report` → блок-маршрут; 5) маршрут → expect-самовызов `this.async(() => this.prompt({role:'ASSISTENT', expect: тип, prompt: servicePrompt, _turn: turn+1}))`, лимит `MAX_AUTO_TURNS` → кнопка «Продолжить».
4. **expect-ходы (ASSISTENT, один проход модели, без классификации словом):** `plan` | `report` — весь md-ответ → блок соответствующего типа + кнопка «Принять» (wait); `task` — «Сделай to do список из согласованного плана» → парс шагов → блок `task` (`state: active`, `steps`, свой `ribbon`) + инъекция первого пункта; `step` | `do` | `research` — **FC-ход**: `buildFunctionsList` контекста → `streamChat({messages, functions})` → ровно один вызов функции или ответ текстом (wait). `research` — только read-only набор (`search`, `fetch_url`, `read_file`, `get_schema`, `find_text`, …), авто-цепочка без кнопок.
5. **Подтверждение изменений.** Любой метод, меняющий файлы (`save_file`/`edit`/`write_file` + `DANGEROUS_METHODS`), — **только через кнопку**: `body.pendingAction = {calls}` + action «Действие/Выполнить», без trust-автопропуска. Read-only вызовы исполняются сразу (`executeToolCall`) → `tool`+`tool_result` → продолжение (в задаче — возврат к пункту, research — следующий поиск, иначе — двухтактный ход). `ask_user({questions})` → блок `questions` (wait).
6. **Кнопки и ответы (реальный вход).** `confirm` по `pendingAction` — выполнить/отклонить вызовы; «Принять» блока `plan` → expect-ход `task`; «Принять» блока `report` → задача `completed` (без хода модели); прочие кнопки — prompt-факт + продолжение. `answers` → закрытие `questions`/`form` (`applyAnswers`), clarify-шаг закрывается сам (`autoAdvanceClarifyStep`) → следующий пункт.
   **Движок шагов:** пункт уходит инъекцией `makeStepInstruction` (step-prompt'ов в ленте нет); `complete_step({step, summary})` с воротами `stepEvidence` ставит `done` и шлёт следующий пункт; все пункты done → expect-ход `report`.
7. Интернет: сервисные tools `search` / `fetch_url` (`services/SearXNG`, `/SERVICES/*` → FC автоматически).
8. **Служебные методы файла:** `stop` — abort текущего цикла (стрим + самовызовы; task/pendingAction не трогает); `change_model({model})` — запись модели в body без on_save.
9. UI — [`handlers/preview`](/$server/$folder/$file/$ai/handlers/preview/$handler/class.js/~/handlers/pages/form/).

Окно логов по умолчанию: 7 дней / до 60 сжатых строк (`body.logWindow` переопределяет).

## 4. Из чего это состоит

- `class.js` — **весь ИИ-харнесс**: схема `TYPES` + `servicePrompt`, методы `prompt` / `stop` / `change_model`, tools + ACL, контекст пары
- `triggers/on_save/$trigger/` — вход в цикл (`taskFile.prompt(...)`)
- `handlers/preview/$handler/` — микрочат

Хелперы — внутри того же `class.js`, не соседним файлом (rules §1.11). Отдельного `methods/prompt` и `sources/modules/ai-prompt` больше нет.

## 5. В каком это состоянии

**Harness — автомат с expect-ходами** (`prompt`). Полный цикл: думай → маршрут словом → expect-ходы (plan/report md + «Принять», task-движок, FC-ходы do/research/step) → подтверждение файл-модифицирующих вызовов кнопкой. Служебные методы файла: `stop` (abort цикла), `change_model` (`body.model` без on_save). Не перенесено: subplan-декомпозиция в ходе, teach-ворота прозы, spawn_agent, usage-учёт, текстовый fallback FC для моделей без functionCalling.

- ✅ Автомат: prompt → thinking → маршрут `research|plan|task|do|report|text`; маршруты в TYPES и истории; продолжение expect-самовызовами с лимитом `MAX_AUTO_TURNS` → «Продолжить»; fallback модели через `findFirstModel`
- ✅ expect-ходы: `plan`/`report` — md-блок + «Принять» (plan → запуск task, report → completed); `task` — to-do → `task.steps` + инъекции пунктов (`makeStepInstruction`, ворота `stepEvidence`, `complete_step`); `step`/`do`/`research` — FC-ходы (`buildFunctionsList` + `streamChat({functions})`), research — read-only набор
- ✅ Подтверждение изменений: любой файл-модифицирующий вызов → `pendingAction` + «Выполнить» (без trust-автопропуска); read-only — сразу; `ask_user` → блок `questions`
- ✅ `stop` — abort текущего цикла (`streamTurn` / самовызовы); `task` / `pendingAction` не сбрасывает; preview → `fetch('stop')`
- ✅ `change_model` — запись `body.model` через fsp (без on_save); preview → `fetch('change_model')`
- ✅ Автомат «одно действие за ход»: реальный промпт → думать → thinking → развилка; инъекции только на острие (в ленте и истории нет `[инструкция]`)
- ✅ Роль-дискриминатор: реальные промпты (USER/BOSS/ADMIN с клиента) vs служебные (ASSISTENT-самовызовы); ролевые варианты `TYPES.*.servicePrompt`
- ✅ Движок шагов: `complete_step` → done + следующий пункт ASSISTENT-инъекцией; «Принять» Отчёта → `completed`
- ✅ Ворота `stepEvidence` (по `step.startedAt`): clarify-шаг = answered опрос, do-шаг = успешный tool_result; Отчёт — только реальные артефакты (`collectArtifacts`)
- ✅ Harness tools: `read_file` / `save_file` / `edit` / `ask_user` / `navigate` / `reset_context` / `complete_step` / `inspect_schema` / …
- ✅ Интернет: `search` + `fetch_url` (сервис SearXNG)
- ✅ Skills-as-tools: `list_skills` / `run_skill`
- ✅ `@/path` mentions в промпте → сниппеты в context
- ✅ Авто-ходы через `this.async` (лимит `MAX_AUTO_TURNS` → action «Продолжить»)
- ✅ GigaChat / z.ai function calling
- ✅ Контекст пары class+user; ACL + pendingAction
- ✅ Preview microchat + TTS Piper
- 🔧 subplan / spawn_agent / usage / teach-ворота — хелперы ещё в файле, в новый `prompt` не подключены
- ❌ host file-handlers / skill-router (запрещены)
- 🔧 Параллельные subagents; trust markings UI; hot-reload self-mod (фаза 5)

## 6. Дальнейшие планы

- Параллельный spawn + merge в родителя
- Trust markings на файлах + plan→diff→confirm→apply для `$class`/handlers
- RAG top-k по окну логов

## 7. Дорожная карта Cursor-аналога

| Фаза | Содержание | Статус |
|------|------------|--------|
| 0 | MVP PDCA + microchat + save_file | ✅ |
| 1 | maxIterations 30 + Continue + orphan tool | ✅ |
| 2 | edit в harness + карточка file | ✅ |
| 3 | skills-as-tools + @path | ✅ |
| 4 | sequential spawn_agent | ✅ |
| 5 | trust + self-mod WORK (whitepaper §10) | 🔧 foundation (`inspect_schema`) |
