# $task — тип файла ИИ-задачи (ai.task)

## 1. Что это

Тип `$task` — файловый носитель диалога и PDCA-цикла встроенного ИИ WORK (`ai.task`). Технически это JSON: корень `type: 'task'` + дерево `items` (+ опционально `todo`, `mode`, `system`, `model`); прикладно — панель управления задачей агента в зоне роли USER / BOSS / ADMIN.

Расширение `.task` (не `.ai`): у `mime-types` `.ai` = PostScript/Illustrator; каноническое имя файла — `ai.task`. `contentType: 'application/json'`.

## 2. Зачем это нужно

Даёт ИИ-управляющему единую точку: увидеть контекст пары user/class, спланировать работу, уточнить данные формой, выполнить шаги с подтверждением. Вход в цикл — через `triggers/on_save` (первый `prompt` с `body.title`) или UI preview (`fetch('prompt'…)`).

## 3. Как это работает

Инвариант: нет `content` — блок живой (в него спускаемся); есть `content` — завершён. Листья получают `content` из стрима или FC; внутренний контейнер — когда `report` (`close`) написал отчёт (`recalc` кладёт текст в `container.content`). `continue` — отклонить отчёт (площадку не закрывать); одно слово-имя шага — то же. `complete` — шаг корня (кнопка), не «итог задачи» в system. Тот же признак у `step` (`todo.recalc` смотрит `st.content`). `state` — подпись сути в шапке (не фаза): `web` — `2/3 Сайт` (успешные / `site.limit`), `explore` — `1 Интернет` (без site), `todo` — `2/5 Шаг`, мыслей нет (справа `time`). APPROVE — тоже `state`.

1. **`on_save`** пишет `body.system` (SYSTEM + режимы `plan`/`do` + профиль / рабочая группа; если `path` совпал — один блок «личная зона») и вызывает `file.prompt`. Если `items` уже есть (чат положил `prompt` / `includes`) — `role: 'AI'`, без второго user-блока; иначе `prompt` из `body.title`.
2. **Роли входа `prompt()`:**
   - default (USER/…) — снять `container.content` (открыть снова); ждущий блок со строкой `stop` — `rejected` и снять `stop`; единственный тип, который метод сам собирает — `{ type:'prompt', content }`;
   - `APPROVE` — флаг `accept` (`true` / `'true'` = принять, иначе отказ). `prompt` — только нагрузка (поля формы). При accept: `approve(params)`, `_save`, пересчёт `_active_*` и обычный ход автомата;
   - `AI` — без нового user-блока (auto-loop).
3. **`PIPE`** — константа в [`class.js`](/$server/$folder/$file/$task/class.js/~/handlers/pages/form/) (не отдельный `pipe.js`). Узел = метаописание типа блока. Корень файла — контейнер `task` (`body.type ??= 'task'`). Метод `prompt()` не ветвится по `type`, кроме входа `prompt`.
   - `plan` / `do` → `{ next: [...] }` — маршруты контейнера по `container.mode || 'plan'`; свой `next` блока важнее `content` (после `prompt` всегда `thinking`); нет своего — меню контейнера; подряд — `container.last` и тип хвоста `items.last`;
   - `prompt` — текст для модели после выбора узла (у площадок нет: настройка в `system` / `plan.system` / `do.system`, в JSON не копируется);
   - `inject` — подпись в меню выбора;
   - `stop` — `true` (конец ветки) или лейбл кнопки (wait + APPROVE); копируется в `block.stop`;
   - `container: true` → у блока `items: []`;
   - `limit` — сколько таких детей можно завести в **этом** контейнере после последнего `prompt` (`explore`: 1, `web`: 3, `site`: 3); нет поля — без потолка; новый user-prompt открывает окно заново;
   - `parse(block)` — пост-обработка ответа модели (`form`, `html`);
   - `approve(params)` — обработка `APPROVE` (`planning`, `form`, `complete`);
   - `recalc(params)` — пересчёт узла: подпись `state` по типу, иконка, `mode` где нужно; у `report` — отчёт в `container.content`, иначе `continue` (отклонить) / имя шага (не закрывать);
   - `run(params)` — ход узла без меню (открытый лист сам себя исполняет). `true` — ход сделан, `_continue` (save + auto-loop);
   - `close` — лист закрывает родителя (`report`): отчёт → `container.content`; `continue` — отклонить, блок остаётся (`rejected`). В `_container_context` узлы `close` не идут в messages. `report` снова в меню, когда есть факты и ни кэш, ни хвост ленты не `report`;
   - `close_prompt` — текст стрима только если узел `close` (`report`). Нет — `PIPE.report.prompt`;
   - `fallback` — узел дрифта, если выбор модели не из меню (`text`);
   - `icon` / `do_icon` — спокойная и живая иконка (`do_icon` у `web` на время search); `fc` — зона вызова (`/` = WORK или путь сервиса); `schema` / `allow` на узле (файловые атомы) или `SCHEMA` сервиса (`web` / `site`); `role`, `build` — где заданы;
   - `done.next` — куда идти, когда контейнер уже с `content`. Нет `done.next` — меню родителя. Лист без своего `next` (`site`) — тоже родитель.
4. **Позиция автомата:**
   - `_active_container()` — спуск в `items.last`, пока у узла есть `items` и нет `content`;
   - `_active_block()` — если у контейнера незакрытый `todo` (шаг без `content` или шагов меньше плана), то `todo`; иначе первый лист без `content` и без `items` (открытый `site`), иначе `items.last` или сам контейнер.
5. **Один шаг `prompt()` после входа:**
   - `PIPE[block.type].run?` — если вернул `true`, `_continue` (save + `prompt({ role: 'AI' })`). Ходы листьев живут на узле: `web.run` (search + очередь `sites`), `site.run` (`fetch_url` + обзор в `content` + следующий `site`), `file.run` (`$file.read_text()`);
   - иначе `next_options`: свой `next` важнее `content`; закрытый контейнер без `done.next` — меню родителя; лист без `next` — родитель; из меню вычитаются `container.last` и `items.last.type`; закрытый контейнер того же типа можно повторить, если он не в этой паре; тип с `limit` — если таких детей после последнего `prompt` уже `>= limit`; `close` — только если `can_close` (есть факты); пустое меню — `chat.done`;
   - пушит блок (без `system` на блоке), стримит: при `close` — `container.close_prompt` или `report.prompt`, иначе `prompt` узла;
   - если у узла `fc` — `_fc_chat`: `node.schema || service.SCHEMA`, `node.allow` (`web` — `search`, `site` — `fetch_url`, `search` — `semantic_search`/`find_text`, `read` — `read_text`, `write` — `save_file`/`save`/`edit`) → цикл стрим с `functions` → `_fc_exec`, пока модель зовёт инструменты (до 5 ходов);
   - `parse?`, `recalc`, `close_up` (узел и предки). У `report` (`close`): сводка → `container.content`; `continue` / имя шага — отклонить, блок в ленте. Auto-loop после меню: `!block.stop` → `this.async` следующего `prompt({ role: 'AI' })` и `return` без `chat.done`. После `run` — `_continue`, если не `_stopped`. `chat.done` — только когда автомат остановился. `_stopped` сбрасывается на USER/APPROVE. Выбор не из меню — узел с `fallback`.
6. **Атомы `web` / `site`** (как `todo` / `step`):
   - `web` — поиск: `system` от `plan`/`do`, `next` = `site`, `report`, `limit: 3`. `web.sites` — вся уникальная выдача, без url соседей того же родителя. Обход — до `site.limit` успешных (`content` и не `error`); ошибка не считается, берём следующий. `webPushNext` из `web.run` / `site.run`. `state` — успешные/`limit`. Закрытие — `report` с `close_prompt`; в `content` код дописывает хвост `[sites]` из `web.sites`;
   - `site` — `limit: 3`. `run`: `fetch_url` на своём `url`, затем стрим (`site.prompt`): с страницы — факты, прайсы, таблицы, ссылки, медиа (только из дампа). В контекст — обрезка (`SITE_PAGE`). `content` — разбор в md (или короткая ошибка), не сырой текст. Title в `label` не пишется. Следующий `site` — после закрытия текущего, пока успешных меньше `limit`.
7. **Атомы `work` / `search` / `read` / `write`:**
   - `work` — контейнер без `fc`. Меню `plan`: `search`, `read`, `report`; `do`: + `write`. `recalc` — rollup детей. Закрытие — `report`;
   - `search` — `fc: '/'`, `semantic_search` / `find_text` на WORK. `content` — список путей (grep: путь:строка — фрагмент). `label` = запрос;
   - `read` — `read_text({path})` через `WORK.get_item` → `$file.read_text()`. `label` = path, `content` = текст (или короткая ошибка);
   - `write` — `save_file` / `save` / `edit`. `content` — факт записи, не тело файла.
8. **Атомы `includes` / `file`:**
   - чат пишет вложения в `items`, не в корень: контейнер `includes` + дети `file` (`path`, `label` = имя). Корневого `body.includes` нет;
   - `includes` — `next`: только `report`. Дети читаются через `file.run`. `recalc` — `N/M Файл`. После `continue` меню пустое (смотрим на живом таске);
   - `file` — лист: `run` → `$file.read_text()` → `content`. Ошибка — `state: 'error'`, короткий текст.
9. **Wait:** `block.stop` — `true` без кнопки (шапка скрыта) или строка-лейбл (action-bar + шапка, `role:'APPROVE'`, `accept`). После решения — `delete block.stop`. Новое сообщение пользователя снимает строковый `stop` у последнего ждущего блока (`rejected`), не по имени типа. Лейбл кнопки с `stop` не сравнивают.
10. **Режимы:** меню корня — `PIPE.task.plan` / `PIPE.task.do` (в обоих `complete` — закрытие таска человеком). Внутренние площадки (`explore`, `work`, `web`, `includes`, `step`, `check`) — `report`. `explore` не меняет `mode`. `check` — площадка после `execute`, не выход. `execute` в `task.do` пока не в меню. Один `todo` на контейнер.
11. **Form / text:** два и больше вопроса — `form`. Только поля, без которых нельзя идти дальше. Ответ: один fenced-блок html (`form`+`fieldset`), после него пояснение 1–10 слов (в ленте `content` над формой). Выбор — только `select` + «Другое» + `input` (не radio/checkbox). Слот прячет ввод, пока «Другое» не выбрано. Скаляр — number/date. `parse` — fence / `<form>` / `fieldset`, хвост в `content`; срезает script, `oda-icon`, button/submit. Раскладка: один `legend` (имя поля, не путь); один select — без `label`; input «Другое» — свой name. `legend`/`label` могут начинаться с эмодзи. Никаких customElements. `text` — дрифт меню. `stop: true`.
12. **Html:** SPA в sandbox-`iframe` (`srcdoc`). `parse` → `block.html`; без `plan`/`do` → `stop` (конец ветки, без approve и auto-loop). Высота через `postMessage`.
13. **Complete / report:** `complete` — шаг корня, `stop: 'Принять'`. `accept` без `prompt` → approved, `task.content = block.content`; иначе `rejected`. `report` — подробный md-отчёт этапа → `container.content`; если у контейнера есть `sites` — хвост `[sites]` + url. `continue` — отклонить, блок остаётся в ленте, в контекст модели не попадает. Новый user-prompt снимает `content` корня и открывает цикл.
14. **Контекст:** `_container_context(container)` — один слой: `system` из `PIPE` (`node[mode].system` / `node.system`, корень — `body.system`) + `[todo]` + `items` как листья (без спуска в `b.items`; узлы `close` / `report` в messages не входят). Открытый контейнер без `content` — в ленту слот «Текущий этап далее (label).» (этап = блоки после маркера, не ярлык). Закрытый — свой `content`. `context()` — путь от корня до активного, склейка `system` слоёв + фраза режима, без этапа в system; ленты через один `push` (два assistant подряд — «продолжай»), хвостовой instruction к последнему user.
15. **Служебное:** `stop` — флаг `_stopped` (обрывает стрим и auto-loop); `change_model` — `body.model`; `_save` — JSON на диск + `session.send({ path })`; `_continue` — `_save` + auto-loop, если не `_stopped`.
16. UI — [`handlers/preview`](/$server/$folder/$file/$task/handlers/preview/$handler/class.js/~/handlers/pages/form/). `streamTarget` — focused без `content`/`html` (стрим до первого токена и во время). Волна на нём, пузыри (`spinners:pulse`) на контейнерах над ним; в JSON не пишется. Слот form только при `html`. `pinned` — `focusedBlock` и предки на пути; закрытая площадка не на пути сворачивается свободно.

## 4. Из чего это состоит

- [`class.js`](/$server/$folder/$file/$task/class.js/~/handlers/pages/form/) — `PIPE` + харнесс: `prompt`, `context`, `_container_context`, `_streamChat`, `_fc_chat`, `_fc_exec`, `_push_block`, `_active_*`, `stop`, `change_model`, `_save`, `_continue`; `report.close`; хелперы `next_options`, `afterLastPrompt`, `can_close`, `childRollup`, `stageOpen`, `siteOk`, `usedSiteUrls`, `webPushNext`, `close_up`, `parentOf`, `clipPage` / `fillFileContent` / `shortError`, `parsePlanMarkdown` / `parseFormHtml` / `formatFormAnswers`
- [`triggers/on_save/$trigger/`](/$server/$folder/$file/$task/triggers/on_save/$trigger/class.js/~/handlers/pages/form/) — system prompt + первый вход в цикл
- [`handlers/preview/$handler/`](/$server/$folder/$file/$task/handlers/preview/$handler/class.js/~/handlers/pages/form/) — микрочат (лента + panel)
- [`readme.md`](/$server/$folder/$file/$task/readme.md/~/handlers/pages/form/) / [`progress.md`](/$server/$folder/$file/$task/progress.md/~/handlers/pages/form/) — знания модуля

## 5. В каком это состоянии

**В активной доработке.** Рабочий каркас FSM в одном `class.js`; FC у `web` / `site` (SearXNG) и у листьев `search` / `read` / `write` (`fc: '/'`).

- ✅ `PIPE` в `class.js`; корень `type: 'task'`; маршруты у контейнера (`plan`/`do` + `mode`)
- ✅ `content` = закрыто: спуск, `next_options`, `todo`/`step`, `complete` (таск) / `report` (площадка)
- ✅ `prompt()`: `run` / меню → push → stream → `parse?` → `recalc` → `close_up` → auto-loop / wait по `stop`
- ✅ подряд в меню — `container.last` и хвост ленты; `report` — если есть факты и оба не `report`
- ✅ стрим `report`: `close_prompt` только при `close`; иначе `prompt` узла. `system` площадки в JSON не пишется
- ✅ `planning.approve` → todo + `mode:'do'`
- ✅ `complete.approve` → `state` / `container.content`; якорь после APPROVE через `_active_*`
- ✅ `html`: SPA в iframe, `parse` → `html`, `stop` без approve/auto-loop
- ✅ `explore` / `work` / `web` / `includes` закрывает `report` (сводка; иначе `continue` = отклонить)
- ✅ `web` сам вызывает `search` (не ждёт function_call модели)
- ✅ `site.content` — разбор страницы в md (факты, прайсы, ссылки), не дамп `fetch_url`
- ✅ `limit` в PIPE (`explore` / `web` / `site`) — окно после последнего `prompt`; `web.sites` — полный список; обход до трёх успешных; хвост `[sites]` в сводке
- ✅ `work` — контейнер; атомы `search` / `read` / `write` с `fc` / `schema` / `allow`
- ✅ вложения в ленте: `includes` + `file` в `items` (чат), чтение; закрытие — `report`
- ❌ Harness tools, `pendingAction`, subplan / spawn_agent

## 6. Дальнейшие планы

- Replan слота todo с учётом закрытых шагов
- Самоподтверждение модели (без `stop`)
- `execute` в `task.do` (`next` уже с `work` / `check` / `report`)
- Harness tools + ACL роли
