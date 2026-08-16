# $task — тип файла ИИ-задачи (ai.task)

## 1. Что это

Тип `$task` — файловый носитель диалога и PDCA-цикла встроенного ИИ WORK (`ai.task`). Технически это JSON с деревом `items` (+ опционально `todo`, `mode`, `system`, `model`); прикладно — панель управления задачей агента в зоне роли USER / BOSS / ADMIN.

Расширение `.task` (не `.ai`): у `mime-types` `.ai` = PostScript/Illustrator; каноническое имя файла — `ai.task`. `contentType: 'application/json'`.

## 2. Зачем это нужно

Даёт ИИ-управляющему единую точку: увидеть контекст пары user/class, спланировать работу, уточнить данные формой, выполнить шаги с подтверждением. Вход в цикл — через `triggers/on_save` (первый `prompt` с `body.title`) или UI preview (`fetch('prompt'…)`).

## 3. Как это работает

1. **`on_save`** пишет `body.system` (SYSTEM + режимы `plan`/`do` + профиль / рабочая группа; если `path` совпал — один блок «личная зона») и вызывает `file.prompt({ role, prompt: body.title })`.
2. **Роли входа `prompt()`:**
   - default (USER/…) — push блока `type:'prompt'` с текстом;
   - `APPROVE` — флаг `accept` (`true` / `'true'` = принять, иначе отказ). `prompt` — только нагрузка (поля формы). При accept: `approve(params)`, `_save`, пересчёт `_active_*` и обычный ход автомата;
   - `AI` — без нового user-блока (auto-loop).
3. **`PIPE`** — константа в [`class.js`](/$server/$folder/$file/$task/class.js/~/handlers/pages/form/) (не отдельный `pipe.js`). Узел = метаописание типа блока:
   - `plan` / `do` → `{ next: [...] }` — маршруты по `container.mode || 'plan'`;
   - `prompt` — текст для модели после выбора узла;
   - `inject` — подпись в меню выбора;
   - `stop` — `true` (конец ветки) или лейбл кнопки (wait + APPROVE); копируется в `block.stop`;
   - `container: true` → у блока `items: []`;
   - `parse(block)` — пост-обработка ответа модели (`form`, `html`, `verdict`);
   - `approve(params)` — обработка `APPROVE` (`planning`, `form`, `complete`);
   - `actualize(params)` — оживление узла на живом дереве (`todo`, `execute`, `check`, `verdict`); у контейнера с `do_icon` пишет `node.icon` (`ready` → `icon`, иначе `do_icon`);
   - `icon` / `do_icon` — спокойная и живая иконка контейнера (`do_icon` ≠ маршрут `do`); `fc` — путь сервиса со `SCHEMA` (у `web` — `/SERVICES/SearXNG`); `role`, `build` — где заданы.
4. **Позиция автомата:**
   - `_active_container()` — спуск в `items.last`, пока у узла есть `items` и нет `ready`;
   - `_active_block()` — если у контейнера `todo.status === 'in_progress'`, то `todo`, иначе `items.last` (или сам контейнер).
5. **Один шаг `prompt()` после входа:** меню — `next_options`. Пушит блок, стримит. Если у узла `fc` — `_fc_chat`: SCHEMA сервиса → цикл стрим с `functions` → `_fc_exec` (пара `function_call` + `role:function`), пока модель зовёт инструменты (до 5 ходов); без вызова — текст в блок (пустой текст → JSON последнего результата). `web` — контейнер: `search` пишет `label`, каждый `fetch_url` пушит `site` (url + favicon, лимит `WEB_SITES`), затем `ready`. `parse?`. Auto-loop: `!block.stop`.
6. **Wait:** `block.stop` — `true` без кнопки (шапка скрыта) или строка-лейбл (action-bar + шапка, `role:'APPROVE'`, `accept`). После решения — `delete block.stop`. Лейбл кнопки с `stop` не сравнивают.
7. **Режимы:** `plan` = `research` / `planning` / `activation`. `do` = `research` / `execute` / `check`. `research` не меняет `mode`. Настройка — `content` площадки (`research`: что исследовать; `execute`: как делать), не узел `thinking`. `check.done.next` и `web.done.next` = `complete`. Готовый контейнер с `done.next` — этот маршрут; иначе меню родителя (`place.next`). Выход из `do` — `check` → `verdict` ok → `check.ready` → `complete`. Один `todo` на контейнер.
8. **Form / text:** два и больше вопроса — `form` (`next: thought`). Все контролы в `fieldset`+`legend` (можно несколько связанных полей); label не дублирует legend; удобный ввод атрибутами, без script. `text` — дрифт: ответ меню не из `options` (даже если имя есть в `PIPE`) или нет узла. `stop: true`. После формы автомат снова в thought.
9. **Html:** SPA в sandbox-`iframe` (`srcdoc`). `parse` → `block.html`; без `plan`/`do` → `stop` (конец ветки, без approve и auto-loop). Высота через `postMessage`.
10. **Complete approve:** `stop: 'Завершить'`. `accept` без `prompt` → approved, `container.ready = true`, `container.content = block.content`; `accept` + `prompt` → `to modify` + «ИТОГ ОТКЛОНЕН, » + prompt; отказ (`accept` нет) — `rejected` без `approve`. Якорь после APPROVE — пересчёт `_active_*`.
11. **Контекст:** `_container_context(container)` — один слой: `system` + `[todo]` + `items` как листья (без спуска в `b.items`). `context()` — путь от корня до активного, склейка `system` слоёв + `[mode] plan|do` активного контейнера, ленты через один `push` (два assistant подряд — «продолжай»), хвостовой instruction к последнему user.
12. **Служебное:** `stop` — флаг `_stopped` на стрим; `change_model` — `body.model`; `_save` — JSON на диск + `session.send({ path })`.
13. UI — [`handlers/preview`](/$server/$folder/$file/$task/handlers/preview/$handler/class.js/~/handlers/pages/form/). Стрим-иконка (`spinners:3-dots-scale`) — оверлей на `focusedBlock`, пока `$pdp.streaming`; в JSON не пишется.

## 4. Из чего это состоит

- [`class.js`](/$server/$folder/$file/$task/class.js/~/handlers/pages/form/) — `PIPE` + харнесс: `prompt`, `context`, `_container_context`, `_streamChat`, `_fc_chat`, `_push_block`, `_active_*`, `stop`, `change_model`, `_save`; хелперы `parsePlanMarkdown` / `parseFormHtml` / `formatFormAnswers`
- [`triggers/on_save/$trigger/`](/$server/$folder/$file/$task/triggers/on_save/$trigger/class.js/~/handlers/pages/form/) — system prompt + первый вход в цикл
- [`handlers/preview/$handler/`](/$server/$folder/$file/$task/handlers/preview/$handler/class.js/~/handlers/pages/form/) — микрочат (лента + panel)
- [`readme.md`](/$server/$folder/$file/$task/readme.md/~/handlers/pages/form/) / [`progress.md`](/$server/$folder/$file/$task/progress.md/~/handlers/pages/form/) — знания модуля

## 5. В каком это состоянии

**В активной доработке.** Рабочий каркас FSM в одном `class.js`; FC есть у `web` (SearXNG).

- ✅ `PIPE` в `class.js`; маршруты через `plan`/`do` + `container.mode`
- ✅ `prompt()`: меню choice → push → stream → `parse?` → auto-loop / wait по `stop`
- ✅ `planning.approve` → todo + `mode:'do'`
- ✅ `complete.approve` → мутация `status`/`ready`/`content`; якорь после APPROVE через `_active_*`
- ✅ `html`: SPA в iframe, `parse` → `html`, `stop` без approve/auto-loop
- ✅ `execute` / `research`: промпт пишет настройку в `content`; `prompt.next` → `research`
- ✅ Меню `plan`/`do` разведены; `work`/`web` — у `execute`/`research`; `text` только дрифт
- ✅ `web` — контейнер: `search` / `fetch_url` → `site` (favicon + url, лимит 2), `done` → `complete`
- ✅ Выход из `do`: площадка `check` → `verdict` ok/fail → при ok авто `complete` на родителе
- ❌ Harness tools, `pendingAction`, subplan / spawn_agent

## 6. Дальнейшие планы

- Replan слота todo с учётом `done`
- Самоподтверждение модели (без `stop`)
- FC у `work` (тот же слот `fc`)
- Complete на корне задачи (без step)
- Harness tools + ACL роли
