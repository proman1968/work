# $task — тип файла ИИ-задачи (ai.task)

## 1. Что это

Тип `$task` — файловый носитель диалога и PDCA-цикла встроенного ИИ WORK (`ai.task`). Технически это JSON: корень `type: 'task'` + дерево `items` (+ опционально `todo`, `mode`, `system`, `model`); прикладно — панель управления задачей агента в зоне роли USER / BOSS / ADMIN.

Расширение `.task` (не `.ai`): у `mime-types` `.ai` = PostScript/Illustrator; каноническое имя файла — `ai.task`. `contentType: 'application/json'`.

## 2. Зачем это нужно

Даёт ИИ-управляющему единую точку: увидеть контекст пары user/class, спланировать работу, уточнить данные формой, выполнить шаги с подтверждением. Вход в цикл — через `triggers/on_save` (первый `prompt` с `body.title`) или UI preview (`fetch('prompt'…)`).

## 3. Как это работает

Инвариант: нет `content` — блок живой (в него спускаемся); есть `content` — завершён. Листья получают `content` из `run` (сервис) или `_pipe_stream` (текст). Внутренний контейнер — когда `report` (`close`) написал отчёт (`recalc` кладёт текст в `container.content` и вырезает лист из ленты). `continue` / имя шага — отклонить (площадку не закрывать, лист всё равно вырезать). `complete` — шаг корня (кнопка), не «итог задачи» в system. Тот же признак у `step` (`todo.recalc` смотрит `st.content`). `state` — подпись сути в шапке (не фаза), сначала текст, потом число: `web` — `Сайты 2/2` (успешные / все `site` в ленте), `explore` — `Интернет 1, Форма 2`, `todo` — `2/5 Шаг`, мыслей нет (справа `time`). APPROVE — тоже `state`.

1. **`on_save`** пишет `body.system` (SYSTEM + **выбор шага** + режимы `plan`/`do` + профиль / рабочая группа; если `path` совпал — один блок «личная зона») и `body.location` из `params.location` (`tz`, lat/lon, `place` через Nominatim; старое `here` снимает). Потом `file.prompt` без локации. Если в `items` уже есть блоки — `role: 'AI'`, без user-блока и без `title` в задачу. Иначе `prompt` из `body.title`. Чат без текста — блока `prompt` нет; имена файлов только во вложениях. Старый таск держит старый `body.system` / без `location`, пока снова не сработает `on_save`.
2. **Роли входа `prompt()`:**
   - default (USER/…) — снять `container.content` (открыть снова); ждущий блок со строкой `stop` — `rejected` и снять `stop`; текст есть — `{ type:'prompt', content }`; `post.files` — `save_files` у `$owner` и новый `{ type:'includes', files }` (старый закрытый `includes` не дополнять); пустой ввод без файлов — блок не создавать;
   - `APPROVE` — флаг `accept` (`true` / `'true'` = принять, иначе отказ). `prompt` — только нагрузка (поля формы). При accept: `approve(params)`, `_save`, пересчёт `_active_*` и обычный ход автомата;
   - `AI` — без нового user-блока (auto-loop / «Продолжить»); сбрасывает `_stopped`.
3. **`PIPE`** — таблица типов в [`pipe.js`](/$server/$folder/$file/$task/pipe.js/~/handlers/pages/form/) (`const PIPE`, грузится в `class.js` через `importScript`). Узел = метаописание типа блока. Хелперы узла (`run` / `recalc` / `parse` / `approve`) живут в том же файле. Общие для харнесса висят на объекте: `PIPE.parentOf`, `close_up`, `includePlan` / `includeReal`, `formatFileHits`, `siteFavicon`, `shortError`, `usedSiteUrls`. Корень файла — контейнер `task` (`body.type ??= 'task'`). Метод `prompt()` не ветвится по `type`, кроме входа `prompt`.
   - `plan` / `do` → `{ next: [...] }` — маршруты контейнера по `container.mode || 'plan'`; свой `next` блока важнее `content` (после `prompt` всегда `thinking`); нет своего — меню контейнера;
   - `prompt` — текст для модели. Лист — стрим сразу. Контейнер — не стримить (даже если слот есть); текст идёт в `report` (+ `CONTINUE`). `system` / `plan.system` / `do.system` в JSON не копируется;
   - `inject` — одна фраза «когда брать» в меню выбора; заголовок меню: один тип из списка; шаг только если без него нельзя; факт в контексте — `TEXT`; лишний шаг хуже, чем сразу ответить;
   - `stop` — `true` (конец ветки) или лейбл кнопки (wait + APPROVE); копируется в `block.stop`;
   - `container: true` → у блока `items: []`;
   - кеш типов — `container.using_blocks` (в JSON, для возобновления). Тип пишется при push. `report` при drop удаляет массив. `step` снимает себя в `todo`, когда текущий шаг закрыт. Новый `prompt` — `delete using_blocks`. Тип в окне один раз; все обычные были — только `report` (`can_close`);
   - `parse(block)` — пост-обработка ответа модели (`form`, `html`);
   - `approve(params)` — обработка `APPROVE` (`planning`, `form`, `complete`);
   - `recalc(params)` — пересчёт узла: подпись `state` по типу, иконка, `mode` где нужно; у `report` — сводка в `container.content` или `continue` / имя шага (не закрывать); лист всегда вырезается из `items`; `step.recalc` зовёт `todo.recalc` (label шага = `N. название`, иначе при push остаётся ярлык «Шаг»);
   - `run(params)` — ход узла без меню (открытый лист сам себя исполняет). `true` — ход сделан, `_continue` (save + auto-loop);
   - `close` — лист закрывает родителя (`report`): отчёт → `container.content`, затем splice и `delete using_blocks`. `continue` / имя шага — отклонить, splice, тоже удалить массив. В `_container_context` узлы `close` не идут в messages. `report` снова в меню, когда есть факты;
   - `fallback` — узел дрифта, если выбор модели не из меню (`text`);
   - `icon` — спокойная иконка в JSON; живая — только UI (`typeIcon` / `streamTarget`); `service` — путь сервиса у `web`; `role`, `build` — где заданы;
   - `done.next` — куда идти, когда контейнер уже с `content`. Нет `done.next` — меню родителя. Лист без своего `next` (`site`) — тоже родитель.
4. **Позиция автомата:**
   - `_active_container()` — спуск в `items.last`, пока у узла есть `items` и нет `content`;
   - `_active_block()` — если у контейнера незакрытый `todo` (шаг без `content` или шагов меньше плана), то `todo`; у `includes` — непрочитанный `file` или сам контейнер, пока список `files` не исчерпан; иначе `items.last` или контейнер. Назад по ленте не ходим: только вперёд или вверх.
5. **Один шаг `prompt()` после входа:**
   - `PIPE[block.type].run?` — если вернул `true`, `_continue`. Сервис зовёт `run` через `_fc_exec`, не стрим. `web.run` — search + `webPushNext`. `site.run` — url + `fetch_url` → `block.page`. `search` / `read` / `file` / `write` — свои `run`. Узел с `run` после push не стримится — сначала `run`;
   - иначе если не контейнер и нет `content` — `_pipe_stream` (лист: свой `prompt`; `close` — `prompt` родителя + `CONTINUE`). Контейнер не стримится;
   - иначе `next_options`: свой `next` важнее `content`; закрытый контейнер без `done.next` — меню родителя; лист без `next` — родитель; типы в `using_blocks` — нет; все обычные были — только `report` (`can_close`); у `task` без текста `prompt` — только `question`; пустое меню — `chat.done`;
   - пушит блок (без `system` на блоке). Есть `run` — следующий ход `run`. Нет стрима и это контейнер — внутрь (`prompt({ role: 'AI' })`). Иначе `_pipe_stream`;
   - `parse?`, `recalc`, `close_up`. У `report` (`close`): сводка → `container.content` или reject; лист из ленты, `using_blocks` удалён. Auto-loop: `!block.stop` → `prompt({ role: 'AI' })`. `chat.done` — когда автомат остановился. Выбор не из меню — узел с `fallback`.
6. **Атомы `web` / `site`** (как `todo` / `step`):
   - `web` — поиск: сервис `/SERVICES/DuckDuckGo` (`search` + `fetch_url`). `system` от `plan`/`do`, `next` = `site`. Запрос — `webQuery`: свой `label` (не ярлык «Интернет»), иначе текст `prompt`. Без запроса / пустая выдача / ошибка сервиса — `state: 'error'` + `content` на `web`, `site` не создаётся. `label` остаётся «Интернет». `web.sites` — `{ url, title }` из выдачи. В окне один `site`. `state` — `Сайты` успешные/всего (ошибка не затирается). В сводку — **Источники**;
   - `site` — один живой на окно. `run`: url из `web.sites`, `fetch_url` → `block.page` с меткой `[site N: url]`; нет url / 403/пусто → `error` + `content`, `delete using_blocks`, следующий url из выдачи. Разбор — `_pipe_stream`; метку в `content` ставит `site.recalc` / `stampSiteContent`, не модель. `label` — hostname.
7. **Атомы `work` / `search` / `read` / `write`:**
   - `work` — контейнер. Меню `plan`: `search`, `read`, `report`; `do`: + `write`. `recalc` — rollup детей. Закрытие — `report`;
   - `search` — `run`: `semantic_search` по запросу (`workQuery`). `content` — список путей. `label` = запрос;
   - `read` — `run`: путь из блока / последнего search, `read_text`. `content` = текст (или короткая ошибка);
   - `write` — сначала стрим (путь + текст), `parse`, затем `run` пишет `save` / `edit`. `content` — факт записи.
8. **Атомы `includes` / `file`:**
   - как `todo` / `step`: чат и `prompt()` пишут список `includes.files` (`path`, `label`, `icon`), `items` пустой. Корневого `body.includes` нет;
   - пока список не прочитан — `next` = `file` (один в ленту). Файл закрыт (`content` или ошибка) — снять `file` с кеша, следующий. Все готовы — `report`;
   - `prompt` — краткое изложение файлов, не отчёт по теме и не вопрос. Стрим только через `report`. `recalc` — `N/M Файл`;
   - `file` — лист: `run` берёт следующий из `files`, `icon` с `$file.icon`, `read_text()` → `content` с шапкой `[file: путь]`. Ошибка — `state: 'error'`, в `content` та же шапка и текст ошибки.
9. **Wait:** `block.stop` — `true` без кнопки (шапка скрыта) или строка-лейбл (action-bar + шапка, `role:'APPROVE'`, `accept`). После решения — `delete block.stop`. Новое сообщение пользователя снимает строковый `stop` у последнего ждущего блока (`rejected`), не по имени типа. Лейбл кнопки с `stop` не сравнивают.
10. **Режимы и выбор:** шаг только если без него нельзя выполнить текущий запрос. Факт уже в контексте (лента, `location`, todo, отчёт) — `text`, не `explore`/`planning`. Дыра у пользователя — `question` / `form`. Внешних фактов нет — `explore`. Несколько несделанных действий — `planning`. Меню корня — `PIPE.task.plan` / `PIPE.task.do` (в обоих `complete` — закрытие таска человеком). В `task` и `step` (`plan`/`do`) есть `question`. Внутренние площадки (`explore`, `work`, `web`, `includes`, `step`, `check`) — `report`. `explore` не меняет `mode`. `check` — площадка после `execute`, не выход. `execute` есть в `task.do`. Один `todo` на контейнер.
11. **Question / form / text:** один вопрос — `question` (`stop: true`, без кнопки). Ответ — следующий `prompt` в ленте, не `answer`. Нет цели — спросить, не искать в интернете. Два и больше вопроса — `form`. Только поля, без которых нельзя идти дальше. Ответ: один fenced-блок html (`form`+`fieldset`), после него пояснение 1–10 слов (в ленте `content` над формой). Выбор — только `select` + «Другое» + `input` (не radio/checkbox). Слот прячет ввод, пока «Другое» не выбрано. Скаляр — number/date. `parse` — fence / `<form>` / `fieldset`, хвост в `content`; срезает script, `oda-icon`, button/submit. Раскладка: один `legend` (имя поля, не путь); один select — без `label`; input «Другое» — свой name. `legend`/`label` могут начинаться с эмодзи. Никаких customElements. `text` — дрифт меню. `stop: true`.
12. **Html:** SPA в sandbox-`iframe` (`srcdoc`). `parse` → `block.html`; без `plan`/`do` → `stop` (конец ветки, без approve и auto-loop). Высота через `postMessage`.
13. **Complete / report:** `complete` — шаг корня, `stop: 'Принять'`. `accept` без `prompt` → approved, `task.content = block.content`; иначе `rejected`. `report` — без своего `prompt`; стрим = `prompt` контейнера + `CONTINUE` → `container.content`, лист вырезается, `using_blocks` удаляется. `recalc` дописывает галерею из детей (`formatGallery`: `![]` / видео, без url уже в тексте; alt — `decodePct`, слаг Canva не пишем) и список **Источники**. Общие `ON_TOPIC` / `MERMAID` — в `STAGE_PROMPT` (explore / work / check / execute), `web.prompt`, `site.prompt`. `continue` / имя шага — отклонить, лист вырезать, массив кеша удалить. Новый user-prompt снимает `content` корня и `using_blocks`.
14. **Контекст:** `_container_context(container)` — один слой: `system` из `PIPE` + `[todo]` + `items` как листья (узлы `close` не входят). У открытого `site` — `block.page` (уже с `[site N: url]`). Открытый контейнер без `content` — слот «Текущий этап далее (label).». `context()` — путь от корня + **сейчас** (`locationNow` из `body.location`) + режим. `locationNow`: дата/время по `tz` и «Пользователь сейчас в точке … (город)».
15. **Служебное:** `stop` — флаг `_stopped` (обрывает стрим и auto-loop); `change_model` — `body.model`; `_save` — JSON на диск + `session.send({ path })`; `_continue` — `_save` + auto-loop, если не `_stopped`.
16. UI — [`handlers/preview`](/$server/$folder/$file/$task/handlers/preview/$handler/class.js/~/handlers/pages/form/). `streamTarget` — focused без `content`/`html` (слот). `streaming` — только `chat.delta` / `chat.done`. `typeIcon`: вертушка на слоте и предках, только пока `streaming`; в JSON не пишется. Слот form только при `html`. `pinned` — `focusedBlock` и предки на пути; закрытая площадка не на пути сворачивается свободно. Sticky: `todo`/`prompt` — host (`todo` = 0, `prompt` = высота todo); контейнер — `summary` (todo + соседний prompt + шапка родителя). Wide (`≥720px`, есть отчёты): справа док (`oda-splitter`, ширина в localStorage); тот же `content` в ленте и в доке; инпут слева под лентой; copy/share в тулбаре дока.

## 4. Из чего это состоит

- [`class.js`](/$server/$folder/$file/$task/class.js/~/handlers/pages/form/) — харнесс: `prompt`, `context`, `_pipe_stream`, `_streamChat`, `_fc_exec`, `_push_block`, `_active_*`, `stop`, `change_model`, `_save`, `_continue`; `CONTINUE`; цикл: `next_options`, `useBlock`, `can_close`, `attachFiles`, `stageOpen`, `containerMode`, `locationNow`
- [`pipe.js`](/$server/$folder/$file/$task/pipe.js/~/handlers/pages/form/) — `PIPE`: типы, `next` / `inject` / `prompt`, `run` / `recalc` / `parse` / `approve` и хелперы узлов
- [`triggers/on_save/$trigger/`](/$server/$folder/$file/$task/triggers/on_save/$trigger/class.js/~/handlers/pages/form/) — system prompt + первый вход в цикл
- [`handlers/preview/$handler/`](/$server/$folder/$file/$task/handlers/preview/$handler/class.js/~/handlers/pages/form/) — микрочат (лента + док + panel)
- [`readme.md`](/$server/$folder/$file/$task/readme.md/~/handlers/pages/form/) / [`progress.md`](/$server/$folder/$file/$task/progress.md/~/handlers/pages/form/) — знания модуля

## 5. В каком это состоянии

**В активной доработке.** FSM в `pipe.js`, цикл в `class.js`. Сервис — только из `run` (`_fc_exec`). Стрим без tools.

- ✅ `PIPE` в `pipe.js`; корень `type: 'task'`; маршруты у контейнера (`plan`/`do` + `mode`)
- ✅ `content` = закрыто: спуск, `next_options`, `todo`/`step`, `complete` (таск) / `report` (площадка)
- ✅ `prompt()`: `run` / меню → push → stream → `parse?` → `recalc` → `close_up` → auto-loop / wait по `stop`
- ✅ кеш типов — `using_blocks` на контейнере; `report` при drop удаляет массив; закрытый `step` снимает себя; новый `prompt` сбрасывает массив
- ✅ стрим: лист — свой `prompt`; контейнер не стримится; `report` — `prompt` родителя + `CONTINUE`. `system` площадки в JSON не пишется
- ✅ `planning.approve` → todo + `mode:'do'`
- ✅ `complete.approve` → `state` / `container.content`; якорь после APPROVE через `_active_*`
- ✅ `html`: SPA в iframe, `parse` → `html`, `stop` без approve/auto-loop
- ✅ `explore` / `work` / `web` / `includes` закрывает `report` (сводка на контейнере, лист вырезается; иначе `continue` = отклонить; в обоих случаях `using_blocks` удалён)
- ✅ нет `fc` на узлах; `search` / `read` / `write` / `web` / `site` / `file` — свой `run`
- ✅ `site.content` — разбор страницы в md (факты по теме, без рекламы; ссылки, `![ ]` / видео из хвостов дампа), не дамп `fetch_url`
- ✅ тип в окне один раз; исчерпание → только `report`; `web.sites` — `{ url, title }`; в сводке **Источники**
- ✅ `work` — контейнер; атомы `search` / `read` / `write` со своим `run`
- ✅ вложения в ленте: `includes` + `file` в `items` (чат), чтение; закрытие — `report`
- ✅ `question` в меню `task` / `step`; без текста `prompt` в корне только `question`; `web.label` не запрос
- ✅ пустой search / нет url: `error` + `content` на блоке, не стрим и не пустой `site`
- ❌ Harness tools, `pendingAction`, subplan / spawn_agent

## 6. Дальнейшие планы

- Replan слота todo с учётом закрытых шагов
- Самоподтверждение модели (без `stop`)
- `execute` в `task.do` (`next` уже с `work` / `check` / `report`)
- Harness tools + ACL роли
