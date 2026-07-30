# $ai — тип файла ИИ-задачи (task.ai)

## 1. Что это

Тип `$ai` — файловый носитель диалога и PDCA-цикла встроенного ИИ WORK (`task.ai`). Технически это JSON с `ribbon`, планом и контекстом; прикладно — панель управления задачей агента в зоне роли USER / BOSS / ADMIN.

**Видение:** агент уровня Cursor/Cline **на пайплайне WORK** (не IDE-host). Дорожная карта — §7.

## 2. Зачем это нужно

Даёт ИИ-управляющему единую точку: увидеть контекст пары user/class (readme, память, логи), спланировать работу, уточнить данные, вызвать tools в ACL роли и при ADMIN — нарастить класс через файлы с подтверждением. Вход в цикл — через `triggers/on_save`, не через host `file-handlers`.

## 3. Как это работает

1. Сохранение / обновление `task.ai` → [`triggers/on_save`](/$server/$folder/$file/$ai/triggers/on_save/$trigger/class.js/~/handlers/pages/form/) вызывает `taskFile.prompt(...)`.
2. **Два вида промптов, различаются ролью.** Реальный (role `USER|BOSS|ADMIN` — всегда приходит с клиента, default USER) пишется блоком `prompt` в ленту. Служебный (role `ASSISTENT` — самовызовы шагов плана и авто-ходов) подаётся **только на острие** messages текущего вызова модели: в ленту и в историю следующих ходов не попадает.
3. `prompt` — **инстанс-метод файла** (наследуется из `class.js` типизатора через merge-цепочку, `this` = файл `task.ai`). Реальный text → блок `prompt` в активный ribbon → `_walk(await _pipe())`. Служебный вход — сразу `_walk(...)` без блока.
4. **Конечный автомат `PIPE`** — дерево состояний вынесено в [`pipe.json`](/$server/$folder/$file/$ai/pipe.json) (чистые данные, грузится лениво через `_pipe()` и кэшируется на инстансе). Один движок `_walk`. Узел = состояние: `prompt` (генерация/инъекция), `inject` (подсказка меню родителя), `next` (дети), `button` (wait), `fc` (function-calling), `askType`. Корень — `thinking`.
   - **Заход в узел**: если есть `prompt` — проход модели (с `fc` если есть, иначе без функций). `thinking` мерджит инструкцию в последний user-промпт; прочие узлы добавляют новое user-сообщение.
   - **Маршрутизация**: `next` из 1 узла → переход напрямую (ASSISTENT); `next` из N узлов → меню «Ответь ОДНИМ словом:\n» + `step — inject` по детям → модель выбирает → переход; не слово → `text` (wait).
   - **Wait-узел** (`button`) → блок + кнопка, стоп до клиента. `plan`/`report` — md + «Принять»; `form`/`questions`/`text` — ask/text + кнопка.
   - **Лист**: `fc`-узел (`web`/`file`/`action`) → `_handle_call` + continue на `thinking`; без `fc` (`step`) → отрендеренный `prompt` как continue-строка (ASSISTENT → `thinking`). `fc`: массив имён | `'*'` (все) | `'readonly'` (только `!mutates` — поиск в рабочей области без записи).
   - **Ворот `allDone`** в `thinking`: все steps done → форс `report`. При active task — инъекция текущего пункта (`_step_injection`) на острие.
5. **Подтверждение изменений.** Метод, меняющий файлы/систему, помечен флагом `mutates` (из JSDoc-тега `@mutates` владельца метода — `buildAiSchema` пробрасывает в схему; harness-псевдометоды `save_file`/`edit` несут `mutates` в `HARNESS_FUNCTIONS`). Любой `mutates`-вызов — **только через кнопку**: `body.pendingAction = {calls}` + action «Выполнить», без trust-автопропуска. Read-only вызовы исполняются сразу (`_execute_call`) → `tool`+`tool_result` → continue. `ask_user({questions})` → блок `questions`/`form` (wait).
6. **Кнопки и ответы (реальный вход, разбор в `prompt` → `_resolve_button`).** `confirm` по `pendingAction` — выполнить/отклонить вызовы; «Принять» блока `plan` → `_walk` к узлу `task`; «Принять» блока `report` → задача `completed` + выход на родительский ribbon (если есть); `answers` → значения в поля `questions`/`form` + continue.
   **Движок шагов:** пункт уходит инъекцией `step.prompt` (step-prompt'ов в ленте нет); `complete_step({step, summary})` ставит `done` и шлёт следующий пункт; все пункты done → ворот `allDone` → `report`.
7. Интернет: сервисные tools `search` / `fetch_url` (`/SERVICES/*` → FC автоматически).
8. **Служебные методы файла:** `stop` — abort текущего цикла (стрим + самовызовы; task/pendingAction не трогает); `change_model({model})` — запись модели в body без on_save.
9. UI — [`handlers/preview`](/$server/$folder/$file/$ai/handlers/preview/$handler/class.js/~/handlers/pages/form/).

Окно логов по умолчанию: 7 дней / до 60 сжатых строк (`body.logWindow` переопределяет).

## 4. Из чего это состоит

- `class.js` — **весь ИИ-харнесс**: движок `_walk` + ленивая загрузка дерева `PIPE` из `pipe.json`, методы `prompt` / `stop` / `change_model`, tools + ACL, контекст пары
- `pipe.json` — **дерево пайплайна** (конечный автомат, чистые данные): узлы-состояния, промпты, `inject`/`next`/`button`/`fc`/`askType`
- `triggers/on_save/$trigger/` — вход в цикл (`taskFile.prompt(...)`)
- `handlers/preview/$handler/` — микрочат

Хелперы — внутри того же `class.js`, не соседним файлом (rules §1.11). Отдельного `methods/prompt` и `sources/modules/ai-prompt` больше нет.

## 5. В каком это состоянии

**Harness — конечный автомат `PIPE` с одним движком `_walk`.** Полный цикл: `prompt` → блок prompt → `_walk(thinking)` → думай → маршрут словом → узел (plan/report md + «Принять», task to-do, FC-ходы action/research) → подтверждение файл-модифицирующих вызовов кнопкой. Служебные методы файла: `stop` (abort цикла), `change_model` (`body.model` без on_save). Не перенесено: subplan-декомпозиция в ходе, teach-ворота прозы, spawn_agent, usage-учёт, текстовый fallback FC для моделей без functionCalling.

- ✅ Конечный автомат `PIPE` вынесен в `pipe.json` (чистые данные, `_pipe()` грузит лениво + кэш): узлы-состояния (`thinking`/`plan`/`task`/`step`/`research`/`search`/`web`/`file`/`ask`/`form`/`questions`/`text`/`action`/`report`), `inject`/`next`/`button`/`fc`; один движок `_walk` (вместо `_<route>` хендлеров и `_confirm`)
- ✅ Маршрутизация: 1 ребёнок → напрямую; N → меню из `inject`; `thinking` мерджит инструкцию в user-промпт
- ✅ Wait-узлы: `plan`/`report` — md + «Принять»; `form`/`questions`/`text` — ask/text + кнопка; `action`+pendingAction — «Выполнить»
- ✅ FC-узлы: `web`/`file`/`action` — `streamChat({functions})` → один вызов или text (wait); `form`/`questions` — `ask_user`. `fc`: массив имён | `'*'` | `'readonly'` (только `!mutates`)
- ✅ Ворот `allDone` в `thinking` → форс `report`; `_step_injection` при active task
- ✅ Разбор кнопок в `prompt` → `_resolve_button` (был `_confirm`): pendingAction, answers, «Принять» plan → `task`, «Принять» report → `completed`
- ✅ Движок шагов: `complete_step` → done + следующий пункт; `step.prompt` как continue-строка
- ✅ Подтверждение изменений: флаг `mutates` (JSDoc `@mutates` владельца + harness) → `pendingAction` + «Выполнить»; read-only — сразу; `ask_user` → `questions`/`form`. Костыли `WRITE_METHODS`/`WORK_READ_METHODS` удалены — единый владелец инварианта (схема метода)
- ✅ `stop` — abort текущего цикла; `change_model` — `body.model` через fsp (без on_save)
- ✅ Роль-дискриминатор: реальные (USER/BOSS/ADMIN с клиента) vs служебные (ASSISTENT-самовызовы)
- ✅ Harness tools: `read_file` / `save_file` / `edit` / `ask_user` / `complete_step` / `get_schema` / `inspect_schema` / `find_text` / `find_item` / `info` / `logs`
- ✅ Интернет: `search` + `fetch_url` (`/SERVICES/*`)
- ✅ Авто-ходы через `this.async` (лимит `MAX_AUTO_TURNS` → action «Продолжить»)
- ✅ GigaChat / z.ai function calling
- ✅ Контекст пары class+user; ACL + pendingAction
- ✅ Preview microchat + TTS Piper
- ✅ Вложения через `post` (FormData → `_handle_attachments`)
- 🔧 subplan / spawn_agent / usage / teach-ворота — не подключены
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
