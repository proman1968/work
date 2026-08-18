# $task — тип файла ИИ-задачи (ai.task)

## 1. Что это

Тип `$task` — файловый носитель диалога и PDCA-цикла встроенного ИИ WORK (`ai.task`). Технически это JSON: корень `type: 'task'` + дерево `items` (+ опционально `todo`, `mode`, `system`, `model`); прикладно — панель управления задачей агента в зоне роли USER / BOSS / ADMIN.

Расширение `.task` (не `.ai`): у `mime-types` `.ai` = PostScript/Illustrator; каноническое имя файла — `ai.task`. `contentType: 'application/json'`.

## 2. Зачем это нужно

Даёт ИИ-управляющему единую точку: увидеть контекст пары user/class, спланировать работу, уточнить данные формой, выполнить шаги с подтверждением. Вход в цикл — через `triggers/on_save` (первый `prompt` с `body.title`) или UI preview (`fetch('prompt'…)`).

## 3. Как это работает

Инвариант: нет `content` — блок живой (в него спускаемся); есть `content` — завершён. Листья получают `content` из стрима или FC; контейнер — когда дети закрыты (`recalc` + `close_up`). Тот же признак у `step` (`todo.recalc` смотрит `st.content`). `state` — подпись сути в шапке (не фаза): `web` — `2/2 Сайт`, `explore` — `1 Интернет` (без site), `todo` — `2/5 Шаг`, мыслей нет (справа `time`). Вердикт APPROVE — тоже `state`.

1. **`on_save`** пишет `body.system` (SYSTEM + режимы `plan`/`do` + профиль / рабочая группа; если `path` совпал — один блок «личная зона») и вызывает `file.prompt`. Если `items` уже есть (чат положил `prompt` / `includes`) — `role: 'AI'`, без второго user-блока; иначе `prompt` из `body.title`.
2. **Роли входа `prompt()`:**
   - default (USER/…) — снять `container.content` (открыть снова); ждущий блок со строкой `stop` — `rejected` и снять `stop`; единственный тип, который метод сам собирает — `{ type:'prompt', content }`;
   - `APPROVE` — флаг `accept` (`true` / `'true'` = принять, иначе отказ). `prompt` — только нагрузка (поля формы). При accept: `approve(params)`, `_save`, пересчёт `_active_*` и обычный ход автомата;
   - `AI` — без нового user-блока (auto-loop).
3. **`PIPE`** — константа в [`class.js`](/$server/$folder/$file/$task/class.js/~/handlers/pages/form/) (не отдельный `pipe.js`). Узел = метаописание типа блока. Корень файла — контейнер `task` (`body.type ??= 'task'`). Метод `prompt()` не ветвится по `type`, кроме входа `prompt`.
   - `plan` / `do` → `{ next: [...] }` — маршруты контейнера по `container.mode || 'plan'`; свой `next` блока важнее `content` (после `prompt` всегда `thinking`); нет своего — меню контейнера; подряд тот же лист не предлагается; закрытую площадку того же типа не повторять;
   - `prompt` — текст для модели после выбора узла (у площадок нет: настройка в `system` / `plan.system` / `do.system`, копируется в блок при push: `node[mode].system || node.system`);
   - `inject` — подпись в меню выбора;
   - `stop` — `true` (конец ветки) или лейбл кнопки (wait + APPROVE); копируется в `block.stop`;
   - `container: true` → у блока `items: []`;
   - `parse(block)` — пост-обработка ответа модели (`form`, `html`, `verdict`);
   - `approve(params)` — обработка `APPROVE` (`planning`, `form`, `complete`);
   - `recalc(params)` — пересчёт узла: подпись `state` по типу, иконка, `mode` где нужно;
   - `run(params)` — ход узла без меню (открытый лист сам себя исполняет). `true` — ход сделан, `_continue` (save + auto-loop);
   - `ready(block)` — дети закрыты, можно писать `content` через `done.prompt`;
   - `fallback` — узел дрифта, если выбор модели не из меню (`text`);
   - `icon` / `do_icon` — спокойная и живая иконка (`do_icon` у `web` на время search); `fc` — зона вызова (`/` = WORK или путь сервиса); `schema` / `allow` на узле (файловые атомы) или `SCHEMA` сервиса (`web` / `site`); `role`, `build` — где заданы;
   - `done.prompt` — ход, которым площадка получает `content` (у `web` / `work` / `explore` / `includes` — обобщение);
   - `done.next` — куда идти, когда контейнер уже с `content`. Нет `done.next` — меню родителя. Лист без своего `next` (`site`) — тоже родитель.
4. **Позиция автомата:**
   - `_active_container()` — спуск в `items.last`, пока у узла есть `items` и нет `content`;
   - `_active_block()` — если у контейнера незакрытый `todo` (шаг без `content` или шагов меньше плана), то `todo`; иначе первый лист без `content` и без `items` (открытый `site`), иначе `items.last` или сам контейнер.
5. **Один шаг `prompt()` после входа:**
   - `PIPE[block.type].run?` — если вернул `true`, `_continue` (save + `prompt({ role: 'AI' })`). Ходы листьев живут на узле: `web.run` (search + очередь `sites`), `site.run` (`fetch_url` + следующий `site`), `file.run` (`$file.read_text()`);
   - иначе контейнер без `content`, есть `done.prompt` и `ready(container)` — стрим обобщения в `container.content`, `close_up`, `_continue`. `ready` на узле: `web` (очередь `sites` пройдена), `explore` (дети закрыты и есть `web` или `work`), `work` (есть `read` или `write`), `includes` (все `file` с `content`);
   - иначе `next_options`: свой `next` важнее `content`; закрытый контейнер без `done.next` — меню родителя; лист без `next` — родитель; тот же лист подряд не предлагается; закрытую площадку того же типа не повторять; пустое меню — `chat.done`;
   - пушит блок (`system` = `node[mode].system || node.system`), стримит;
   - если у узла `fc` — `_fc_chat`: `node.schema || service.SCHEMA`, `node.allow` (`web` — `search`, `site` — `fetch_url`, `search` — `semantic_search`/`find_text`, `read` — `read_text`, `write` — `save_file`/`save`/`edit`) → цикл стрим с `functions` → `_fc_exec`, пока модель зовёт инструменты (до 5 ходов);
   - `parse?`, `recalc`, `close_up` (узел и предки). Auto-loop после меню: `!block.stop` → `this.async` следующего `prompt({ role: 'AI' })` и `return` без `chat.done`. После `run` / `done.prompt` — всегда `_continue`, если не `_stopped`. `chat.done` — только когда автомат остановился. `_stopped` сбрасывается на USER/APPROVE. Выбор не из меню — узел с `fallback`.
6. **Атомы `web` / `site`** (как `todo` / `step`):
   - `web` — поиск: `system` от `plan`/`do`, `next` = `site`. Очередь url в `web.sites` (первые `WEB_SITES` уникальных из search). Следующий `site` — `webPushNext` из `web.run` / `site.run` (url / label = url / favicon). `recalc` только `state` и иконка. Все посещены — `ready` + `done.prompt`, модель пишет `web.content`. Выход в родителя (`explore` / `task`), не в `check`;
   - `site` — `run`: `fetch_url` на своём `url`. Title в `label` не пишется. Текст страницы (или ошибка) → `site.content`.
7. **Атомы `work` / `search` / `read` / `write`:**
   - `work` — контейнер без `fc`. Меню `plan`: `search`, `read`; `do`: + `write`. `recalc` — rollup детей. Все дети с `content` и есть `read`/`write` — `done.prompt`, модель пишет `work.content`;
   - `search` — `fc: '/'`, `semantic_search` / `find_text` на WORK. `content` — список путей (grep: путь:строка — фрагмент). `label` = запрос;
   - `read` — `read_text({path})` через `WORK.get_item` → `$file.read_text()`. `label` = path, `content` = текст (или короткая ошибка);
   - `write` — `save_file` / `save` / `edit`. `content` — факт записи, не тело файла.
8. **Атомы `includes` / `file`:**
   - чат пишет вложения в `items`, не в корень: контейнер `includes` + дети `file` (`path`, `label` = имя). Корневого `body.includes` нет;
   - `includes` — контейнер без меню. Дети читаются через `file.run`. `recalc` — `N/M Файл`. Все прочитаны — `ready` + `done.prompt`, модель пишет `includes.content`;
   - `file` — лист: `run` → `$file.read_text()` → `content`. Ошибка — `state: 'error'`, короткий текст.
9. **Wait:** `block.stop` — `true` без кнопки (шапка скрыта) или строка-лейбл (action-bar + шапка, `role:'APPROVE'`, `accept`). После решения — `delete block.stop`. Новое сообщение пользователя снимает строковый `stop` у последнего ждущего блока (`rejected`), не по имени типа. Лейбл кнопки с `stop` не сравнивают.
10. **Режимы:** меню корня — `PIPE.task.plan` / `PIPE.task.do` (в обоих есть `complete` — итог всего таска). `explore` не меняет `mode`. Закрытие обзора — `done.prompt` (есть закрытый `web` или `work`, все дети с `content`). `check` — только выход из `work` / `do`. Один `todo` на контейнер.
11. **Form / text:** два и больше вопроса — `form`. Только поля, без которых нельзя идти дальше. Ответ: один fenced-блок html (`form`+`fieldset`), после него пояснение 1–10 слов (в ленте `content` над формой). Выбор — только `select` + «Другое» + `input` (не radio/checkbox). Слот прячет ввод, пока «Другое» не выбрано. Скаляр — number/date. `parse` — fence / `<form>` / `fieldset`, хвост в `content`; срезает script, `oda-icon`, button/submit. Раскладка: один `legend` (имя поля, не путь); один select — без `label`; input «Другое» — свой name. `legend`/`label` могут начинаться с эмодзи. Никаких customElements. `text` — дрифт меню. `stop: true`.
12. **Html:** SPA в sandbox-`iframe` (`srcdoc`). `parse` → `block.html`; без `plan`/`do` → `stop` (конец ветки, без approve и auto-loop). Высота через `postMessage`.
13. **Complete:** отчёт — результат из ленты (факты, таблицы), не пересказ процесса. `stop: 'Принять'`. `accept` без `prompt` → approved, `container.content = block.content`; закрытый контейнер — `next_options` пуст, `chat.done`. Новый user-prompt снимает `content` и открывает цикл. Отказ, комментарий или новое сообщение вместо кнопки — `rejected`.
14. **Контекст:** `_container_context(container)` — один слой: `system` + `[todo]` + `items` как листья (без спуска в `b.items`). `context()` — путь от корня до активного, склейка `system` слоёв + фраза текущего режима («Сейчас режим планирования/исполнения», не тег `[mode]`), ленты через один `push` (два assistant подряд — «продолжай»), хвостовой instruction к последнему user.
15. **Служебное:** `stop` — флаг `_stopped` (обрывает стрим и auto-loop); `change_model` — `body.model`; `_save` — JSON на диск + `session.send({ path })`; `_continue` — `_save` + auto-loop, если не `_stopped`.
16. UI — [`handlers/preview`](/$server/$folder/$file/$task/handlers/preview/$handler/class.js/~/handlers/pages/form/). `streamTarget` — focused без `content`/`html` (стрим до первого токена и во время). Волна на нём, пузыри (`spinners:pulse`) на контейнерах над ним; в JSON не пишется. Слот form только при `html`. `pinned` — `focusedBlock` и предки на пути; закрытая площадка не на пути сворачивается свободно.

## 4. Из чего это состоит

- [`class.js`](/$server/$folder/$file/$task/class.js/~/handlers/pages/form/) — `PIPE` + харнесс: `prompt`, `context`, `_container_context`, `_streamChat`, `_fc_chat`, `_fc_exec`, `_push_block`, `_active_*`, `stop`, `change_model`, `_save`, `_continue`; хелперы `next_options`, `childRollup`, `webPushNext`, `close_up`, `parentOf`, `exploreReady` / `workReady` / `includesReady` / `fillFileContent` / `shortError`, `parsePlanMarkdown` / `parseFormHtml` / `formatFormAnswers`
- [`triggers/on_save/$trigger/`](/$server/$folder/$file/$task/triggers/on_save/$trigger/class.js/~/handlers/pages/form/) — system prompt + первый вход в цикл
- [`handlers/preview/$handler/`](/$server/$folder/$file/$task/handlers/preview/$handler/class.js/~/handlers/pages/form/) — микрочат (лента + panel)
- [`readme.md`](/$server/$folder/$file/$task/readme.md/~/handlers/pages/form/) / [`progress.md`](/$server/$folder/$file/$task/progress.md/~/handlers/pages/form/) — знания модуля

## 5. В каком это состоянии

**В активной доработке.** Рабочий каркас FSM в одном `class.js`; FC у `web` / `site` (SearXNG) и у листьев `search` / `read` / `write` (`fc: '/'`).

- ✅ `PIPE` в `class.js`; корень `type: 'task'`; маршруты у контейнера (`plan`/`do` + `mode`)
- ✅ `content` = закрыто: спуск, `next_options`, `todo`/`step`, `complete` / `verdict`
- ✅ `prompt()`: `run` / `ready`+`done.prompt` / меню → push → stream → `parse?` → `close_up` → auto-loop / wait по `stop`
- ✅ `planning.approve` → todo + `mode:'do'`
- ✅ `complete.approve` → `state` / `container.content`; якорь после APPROVE через `_active_*`
- ✅ `html`: SPA в iframe, `parse` → `html`, `stop` без approve/auto-loop
- ✅ `explore.done.prompt` закрывает обзор (`web` или `work`); `check` только у `work`
- ✅ `web` сам вызывает `search` (не ждёт function_call модели)
- ✅ `work` — контейнер; атомы `search` / `read` / `write` с `fc` / `schema` / `allow`
- ✅ вложения в ленте: `includes` + `file` в `items` (чат), чтение и `done.prompt`
- ❌ Harness tools, `pendingAction`, subplan / spawn_agent

## 6. Дальнейшие планы

- Replan слота todo с учётом закрытых шагов
- Самоподтверждение модели (без `stop`)
- `work` в `execute.next`
- Harness tools + ACL роли
