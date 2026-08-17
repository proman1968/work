# $task — тип файла ИИ-задачи (ai.task)

## 1. Что это

Тип `$task` — файловый носитель диалога и PDCA-цикла встроенного ИИ WORK (`ai.task`). Технически это JSON: корень `type: 'task'` + дерево `items` (+ опционально `todo`, `mode`, `system`, `model`); прикладно — панель управления задачей агента в зоне роли USER / BOSS / ADMIN.

Расширение `.task` (не `.ai`): у `mime-types` `.ai` = PostScript/Illustrator; каноническое имя файла — `ai.task`. `contentType: 'application/json'`.

## 2. Зачем это нужно

Даёт ИИ-управляющему единую точку: увидеть контекст пары user/class, спланировать работу, уточнить данные формой, выполнить шаги с подтверждением. Вход в цикл — через `triggers/on_save` (первый `prompt` с `body.title`) или UI preview (`fetch('prompt'…)`).

## 3. Как это работает

Инвариант: нет `content` — блок живой (в него спускаемся); есть `content` — завершён. Листья получают `content` из стрима или FC; контейнер — когда дети закрыты (`recalc` + `close_up`). Тот же признак у `step` (`todo.recalc` смотрит `st.content`). `state` — подпись сути в шапке (не фаза): `web` — `2/2 Сайт`, `explore` — `1 Интернет` (без site), `todo` — `2/5 Шаг`, мыслей нет (справа `time`). Вердикт APPROVE — тоже `state`.

1. **`on_save`** пишет `body.system` (SYSTEM + режимы `plan`/`do` + профиль / рабочая группа; если `path` совпал — один блок «личная зона») и вызывает `file.prompt({ role, prompt: body.title })`.
2. **Роли входа `prompt()`:**
   - default (USER/…) — push блока `type:'prompt'` с текстом;
   - `APPROVE` — флаг `accept` (`true` / `'true'` = принять, иначе отказ). `prompt` — только нагрузка (поля формы). При accept: `approve(params)`, `_save`, пересчёт `_active_*` и обычный ход автомата;
   - `AI` — без нового user-блока (auto-loop).
3. **`PIPE`** — константа в [`class.js`](/$server/$folder/$file/$task/class.js/~/handlers/pages/form/) (не отдельный `pipe.js`). Узел = метаописание типа блока. Корень файла — контейнер `task` (`body.type ??= 'task'`).
   - `plan` / `do` → `{ next: [...] }` — маршруты контейнера по `container.mode || 'plan'`; свой `next` блока важнее `content` (после `prompt` всегда `thinking`); нет своего — меню контейнера; подряд тот же лист не предлагается; закрытую площадку того же типа не повторять;
   - `prompt` — текст для модели после выбора узла (у площадок нет: настройка в `system` / `plan.system` / `do.system`, копируется в блок при push: `node[mode].system || node.system`);
   - `inject` — подпись в меню выбора;
   - `stop` — `true` (конец ветки) или лейбл кнопки (wait + APPROVE); копируется в `block.stop`;
   - `container: true` → у блока `items: []`;
   - `parse(block)` — пост-обработка ответа модели (`form`, `html`, `verdict`);
   - `approve(params)` — обработка `APPROVE` (`planning`, `form`, `complete`);
   - `recalc(params)` — пересчёт узла: подпись `state` по типу, иконка, `mode` где нужно;
   - `icon` / `do_icon` — спокойная и живая иконка (`do_icon` у `web` на время search); `fc` — путь сервиса со `SCHEMA`; `role`, `build` — где заданы;
   - `done.prompt` — ход, которым площадка получает `content` (у `web` — обобщение);
   - `done.next` — куда идти, когда контейнер уже с `content`. Нет `done.next` — меню родителя. Лист без своего `next` (`site`) — тоже родитель.
4. **Позиция автомата:**
   - `_active_container()` — спуск в `items.last`, пока у узла есть `items` и нет `content`;
   - `_active_block()` — если у контейнера незакрытый `todo` (шаг без `content` или шагов меньше плана), то `todo`; иначе первый лист без `content` и без `items` (открытый `site`), иначе `items.last` или сам контейнер.
5. **Один шаг `prompt()` после входа:**
   - открытый `web` без `sites` — сам `web` вызывает `search` (как `site` — `fetch_url`), query из `label` / запроса пользователя; пишет очередь `web.sites`;
   - `explore` без `content`, все дети закрыты и есть `web` — стрим `explore.done.prompt` → `explore.content`;
   - очередь `sites` пройдена, у `web` нет `content` — стрим `done.prompt` на контейнере `web` (после `site` без `next` контекст снова `web`);
   - открытый `site` (`url` есть, `content` нет) — сразу `_fc_exec(fetch_url)` на этом блоке, `close_up`, auto-loop; новый тип не выбирается;
   - иначе `next_options`: свой `next` важнее `content`; закрытый контейнер без `done.next` — меню родителя; лист без `next` — родитель; тот же лист подряд не предлагается; закрытую площадку того же типа не повторять; пустое меню — `chat.done`;
   - пушит блок (`system` = `node[mode].system || node.system`), стримит;
   - если у узла `fc` — `_fc_chat`: SCHEMA сервиса (у `web` только `search`, у `site` только `fetch_url`) → цикл стрим с `functions` → `_fc_exec`, пока модель зовёт инструменты (до 5 ходов);
   - `parse?`, `recalc`, `close_up` (узел и предки). Auto-loop: `!block.stop` → `this.async` следующего `prompt({ role: 'AI' })` и `return` без `chat.done`. `chat.done` — только когда автомат остановился. `_stopped` сбрасывается на USER/APPROVE.
6. **Атомы `web` / `site`** (как `todo` / `step`):
   - `web` — поиск: `system` от `plan`/`do`, `next` = `site`. Очередь url в `web.sites` (уникальные из search). Следующий `site` пушит `prompt()` (`webPushNext`: url / label = url / favicon). `recalc` только `state` и иконка. Все посещены — `done.prompt`, модель пишет `web.content`. Выход в родителя (`explore` / `task`), не в `check`;
   - `site` — только `fetch_url` на своём `url`. Title в `label` не пишется. Текст страницы (или ошибка) → `site.content`.
7. **Wait:** `block.stop` — `true` без кнопки (шапка скрыта) или строка-лейбл (action-bar + шапка, `role:'APPROVE'`, `accept`). После решения — `delete block.stop`. Лейбл кнопки с `stop` не сравнивают.
8. **Режимы:** меню корня — `PIPE.task.plan` / `PIPE.task.do`. `explore` не меняет `mode`. Закрытие обзора — `done.prompt` (есть закрытый `web`, все дети с `content`). `check` — только выход из `work` / `do`. Один `todo` на контейнер.
9. **Form / text:** два и больше вопроса — `form`. Все контролы в `fieldset`+`legend` (можно несколько связанных полей); label не дублирует legend; удобный ввод атрибутами, без script. `text` — дрифт: ответ меню не из `options` (даже если имя есть в `PIPE`) или нет узла. `stop: true`.
10. **Html:** SPA в sandbox-`iframe` (`srcdoc`). `parse` → `block.html`; без `plan`/`do` → `stop` (конец ветки, без approve и auto-loop). Высота через `postMessage`.
11. **Complete approve:** `stop: 'Завершить'`. `accept` без `prompt` → approved, `container.content = block.content`; `accept` + `prompt` → `to modify` + «ИТОГ ОТКЛОНЕН, » + prompt; отказ (`accept` нет) — `rejected` без `approve`. Якорь после APPROVE — пересчёт `_active_*`.
12. **Контекст:** `_container_context(container)` — один слой: `system` + `[todo]` + `items` как листья (без спуска в `b.items`). `context()` — путь от корня до активного, склейка `system` слоёв + `[mode] plan|do` активного контейнера, ленты через один `push` (два assistant подряд — «продолжай»), хвостовой instruction к последнему user.
13. **Служебное:** `stop` — флаг `_stopped` (обрывает стрим и auto-loop); `change_model` — `body.model`; `_save` — JSON на диск + `session.send({ path })`.
14. UI — [`handlers/preview`](/$server/$folder/$file/$task/handlers/preview/$handler/class.js/~/handlers/pages/form/). Стрим-иконка (`spinners:3-dots-scale`) — оверлей на `focusedBlock`, пока `$pdp.streaming`; в JSON не пишется. `pinned` — `focusedBlock` и предки на пути; закрытая площадка не на пути сворачивается свободно.

## 4. Из чего это состоит

- [`class.js`](/$server/$folder/$file/$task/class.js/~/handlers/pages/form/) — `PIPE` + харнесс: `prompt`, `context`, `_container_context`, `_streamChat`, `_fc_chat`, `_fc_exec`, `_push_block`, `_active_*`, `stop`, `change_model`, `_save`; хелперы `next_options`, `childRollup`, `webPushNext`, `close_up`, `parentOf`, `parsePlanMarkdown` / `parseFormHtml` / `formatFormAnswers`
- [`triggers/on_save/$trigger/`](/$server/$folder/$file/$task/triggers/on_save/$trigger/class.js/~/handlers/pages/form/) — system prompt + первый вход в цикл
- [`handlers/preview/$handler/`](/$server/$folder/$file/$task/handlers/preview/$handler/class.js/~/handlers/pages/form/) — микрочат (лента + panel)
- [`readme.md`](/$server/$folder/$file/$task/readme.md/~/handlers/pages/form/) / [`progress.md`](/$server/$folder/$file/$task/progress.md/~/handlers/pages/form/) — знания модуля

## 5. В каком это состоянии

**В активной доработке.** Рабочий каркас FSM в одном `class.js`; FC есть у `web` / `site` (SearXNG).

- ✅ `PIPE` в `class.js`; корень `type: 'task'`; маршруты у контейнера (`plan`/`do` + `mode`)
- ✅ `content` = закрыто: спуск, `next_options`, `todo`/`step`, `complete` / `verdict`
- ✅ `prompt()`: меню choice → push → stream → `parse?` → `close_up` → auto-loop / wait по `stop`
- ✅ `planning.approve` → todo + `mode:'do'`
- ✅ `complete.approve` → `state` / `container.content`; якорь после APPROVE через `_active_*`
- ✅ `html`: SPA в iframe, `parse` → `html`, `stop` без approve/auto-loop
- ✅ `explore.done.prompt` закрывает обзор; `check` только у `work`
- ✅ `web` сам вызывает `search` (не ждёт function_call модели)
- ❌ Harness tools, `pendingAction`, subplan / spawn_agent

## 6. Дальнейшие планы

- Тот же паттерн `content` / атомы у `work` (search/read/write/grep)
- Replan слота todo с учётом закрытых шагов
- Самоподтверждение модели (без `stop`)
- FC у `work` (тот же слот `fc`)
- Complete на корне задачи (без step)
- Harness tools + ACL роли
