# $task — тип файла ИИ-задачи (ai.task)

## 1. Что это

Тип `$task` — файловый носитель диалога и PDCA-цикла встроенного ИИ WORK (`ai.task`). Технически это JSON с деревом `items` (+ опционально `todo`, `mode`, `system`, `model`); прикладно — панель управления задачей агента в зоне роли USER / BOSS / ADMIN.

Расширение `.task` (не `.ai`): у `mime-types` `.ai` = PostScript/Illustrator; каноническое имя файла — `ai.task`. `contentType: 'application/json'`.

## 2. Зачем это нужно

Даёт ИИ-управляющему единую точку: увидеть контекст пары user/class, спланировать работу, уточнить данные формой, выполнить шаги с подтверждением. Вход в цикл — через `triggers/on_save` (первый `prompt` с `body.title`) или UI preview (`fetch('prompt'…)`).

## 3. Как это работает

1. **`on_save`** пишет `body.system` (SYSTEM + user/class info + роль) и вызывает `file.prompt({ role, prompt: body.title })`.
2. **Роли входа `prompt()`:**
   - default (USER/…) — push блока `type:'prompt'` с текстом;
   - `APPROVE` — `PIPE[active].approve(params)`, затем обычный ход автомата;
   - `AI` — без нового user-блока (auto-loop).
3. **`PIPE`** — константа в [`class.js`](/$server/$folder/$file/$task/class.js/~/handlers/pages/form/) (не отдельный `pipe.js`). Узел = метаописание типа блока:
   - `plan` / `do` → `{ next: [...] }` — маршруты по `container.mode || 'plan'`;
   - `prompt` — текст для модели после выбора узла;
   - `inject` — подпись в меню выбора;
   - `allow_approve` → при создании блока кладётся `button: { label }`;
   - `container: true` → у блока `items: []`;
   - `parse(block)` — пост-обработка ответа модели (`form`, `html`);
   - `approve(params)` — обработка `APPROVE` (`planning`, `form`, `complete`);
   - `icon`, `role`, `fc`, `build` — где заданы в реестре.
4. **Позиция автомата:**
   - `_active_container()` — спуск в `items.last`, пока у узла есть `items` и нет `ready`;
   - `_active_block()` — если у контейнера `todo.status === 'in_progress'`, то `todo`, иначе `items.last` (или сам контейнер).
5. **Один шаг `prompt()` после входа:** берёт `options = pipe_step[mode].next`; при одном варианте — сразу choice, иначе silent-меню модели по `inject`; неизвестный choice → `text`. Пушит блок `{ type, icon, stop, button?, items? }`, при `next_pipe.prompt` стримит ответ → `Object.assign(block, response)` → `parse?`. Auto-loop: `!block.stop && !block.button` → `this.async(() => prompt({ role:'AI' }))`.
6. **Wait:** стоп цикла по `block.button` (из `allow_approve`) или `block.stop` (нет `plan`/`do` у узла). UI action-bar шлёт `role:'APPROVE'`.
7. **Planning approve:** `true` → `parsePlanMarkdown` → `container.todo` + `mode:'do'`, тип блока → `plan`, возврат `todo` как следующего якоря; `false` / иной текст — reject / to modify.
8. **Form:** wait-блок со слотом в preview. После стрима `parse` → `fields` + пояснение в `content`, `values={}`. Опционально `ui` — кастомный виджет слота. UI пишет в `block.values`. Approve: `false` — отмена; иначе JSON/`values` → `answers` + слепок в `content`.
9. **Html:** SPA в sandbox-`iframe` (`srcdoc`). `parse` → `block.html`; без `plan`/`do` → `stop` (конец ветки, без approve и auto-loop). Высота через `postMessage`.
10. **Complete approve:** `allow_approve: 'Завершить'`. `true` → `container.ready = true` на вышестоящем `step`, якорь → `todo` (следующий step); `false` → reject и `thought`. После APPROVE контейнер пересчитывается.
11. **Контекст:** `collect_context` — `container.system` + `[todo]` + `items[].content` (роли из `PIPE[type].role` или `assistant`) + optional instruction.
12. **Служебное:** `stop` — флаг `_stopped` на стрим; `change_model` — `body.model`; `_save` — JSON на диск + `session.send({ path })`.
13. UI — [`handlers/preview`](/$server/$folder/$file/$task/handlers/preview/$handler/class.js/~/handlers/pages/form/).

## 4. Из чего это состоит

- [`class.js`](/$server/$folder/$file/$task/class.js/~/handlers/pages/form/) — `PIPE` + харнесс: `prompt`, `collect_context`, `_streamChat`, `_push_block`, `_active_*`, `stop`, `change_model`, `_save`; хелперы `parsePlanMarkdown` / `parseFormContent` / `parseHtmlContent` / `formatFormAnswers`
- [`triggers/on_save/$trigger/`](/$server/$folder/$file/$task/triggers/on_save/$trigger/class.js/~/handlers/pages/form/) — system prompt + первый вход в цикл
- [`handlers/preview/$handler/`](/$server/$folder/$file/$task/handlers/preview/$handler/class.js/~/handlers/pages/form/) — микрочат (лента + panel)
- [`readme.md`](/$server/$folder/$file/$task/readme.md/~/handlers/pages/form/) / [`progress.md`](/$server/$folder/$file/$task/progress.md/~/handlers/pages/form/) — знания модуля

## 5. В каком это состоянии

**В активной доработке.** Рабочий каркас FSM в одном `class.js`; полный harness (FC/tools) ещё не подключён.

- ✅ `PIPE` в `class.js`; маршруты через `plan`/`do` + `container.mode`
- ✅ `prompt()`: меню choice → push → stream → `parse?` → auto-loop / wait по `button`|`stop`
- ✅ `planning.approve` → todo + `mode:'do'`
- ✅ `complete.approve` → закрывает `step.ready`, возврат к `todo`; после APPROVE — refresh container
- ✅ `html`: SPA в iframe, `parse` → `html`, `stop` без approve/auto-loop
- 🔧 Узлы `research` / `web` / `work`: в реестре есть `next`/`fc`/`build`, но ход автомата читает только `plan`/`do` — ветки фактически не в меню thought
- 🔧 `_streamChat` принимает `functions`, но `prompt()` их не передаёт; `calls` копятся, диспетчера tool нет
- 🔧 Auto-add `complete` в меню контейнеров — нет
- 🔧 Complete на корне (без step) — только status, без закрытия контейнера
- ❌ Harness tools, `pendingAction`, subplan / spawn_agent

## 6. Дальнейшие планы

- Свести «висящие» узлы (`research`/`web`/`work`) к контракту `plan`/`do`
- Подключить FC: `functions` в `_streamChat`, исполнение `calls`
- Complete на корне задачи (без step)
- Harness tools + ACL роли
