# $task — тип файла ИИ-задачи (ai.task)

## 1. Что это

Тип `$task` — файловый носитель диалога и PDCA-цикла встроенного ИИ WORK (`ai.task`). Технически это JSON: корень `type: 'task'` + дерево `items` (+ опционально `todo`, `mode`, `system`, `model`); прикладно — панель управления задачей агента в зоне роли USER / BOSS / ADMIN.

Расширение `.task` (не `.ai`): у `mime-types` `.ai` = PostScript/Illustrator; каноническое имя файла — `ai.task`. `contentType: 'application/json'`.

## 2. Зачем это нужно

Даёт ИИ-управляющему единую точку: увидеть контекст пары user/class, спланировать работу, уточнить данные формой, выполнить шаги с подтверждением. Вход в цикл — через `triggers/on_save` (`file.prompt(params)`) или UI preview (`fetch('prompt'…)`).

## 3. Как это работает

Инвариант: нет `content` — блок живой (в него спускаемся); есть `content` — завершён. Листья получают `content` из `init` (сервис) или стрима (`_streamChat`). Внутренний контейнер закрывает `total` (`close`): `init` пишет итог в `container.content` и возвращает `false` — лист не пушится. `report` — шаг корня (кнопка). Тот же признак у `step` (`todo.recalc` смотрит `st.content`). `state` — подпись сути в шапке (не фаза), сначала текст, потом число: `web` — `Сайты 2/2` (успешные / все `site` в ленте), `explore` — `Интернет 1, Форма 2`, `todo` — `2/5 Шаг`, мыслей нет (справа `time`). APPROVE — тоже `state`.

1. **`on_save`** пишет `body.system` (SYSTEM + **выбор шага** + режимы `plan`/`do` + профиль / рабочая группа; если `path` совпал — один блок «личная зона»; место из `params.location` — точка и город, Nominatim). `body.tz` — пояс для часов. Поля `location` / `here` нет. Потом `file.prompt(params)` с `prompt: body.title`, роль как пришла. Старый таск держит старый `body.system`, пока снова не сработает `on_save`.
2. **Роли входа `prompt()`:**
   - default (USER/…) — текст есть — `{ type:'prompt', content }`; `post.files` — `save_files` у `$owner` и новый `{ type:'includes', files }` (старый закрытый `includes` не дополнять); пустой ввод без файлов — блок не создавать;
   - `APPROVE` — флаг `accept` (`true` / `'true'` = принять, иначе отказ). `prompt` — только нагрузка (поля формы). При accept: `approve(params)`, `_save`, пересчёт `_active_*` и обычный ход автомата;
   - `AI` — без нового user-блока (auto-loop / «Продолжить»); сбрасывает `_stopped`.
3. **Узлы** — именованные экспорты в [`pipe.js`](/$server/$folder/$file/$task/pipe.js/~/handlers/pages/form/) (`export const thinking`, `web`, …). Реестра `PIPE` нет. Харнесс грузит модуль целиком (`this.pipe`, не `importScript` / default) и берёт узел как `pipe[type]`. Хелперы якоря вложений — `export function includePlan` / `includeReal`. Корень файла — контейнер `task` (`body.type ??= 'task'`). Метод `prompt()` не ветвится по `type`, кроме входа `prompt`.
   - `plan` / `do` → `{ next: [...] }` — маршруты контейнера по `container.mode || 'plan'`; свой `next` блока важнее `content` (после `prompt` всегда `thinking`); нет своего — меню контейнера;
   - `prompt` — текст для модели. Лист — стрим сразу. Контейнер — не стримить (даже если слот есть); текст идёт в `total` (`prompt` родителя). `system` / `plan.system` / `do.system` в JSON не копируется;
   - `inject` — одна фраза «когда брать» в меню выбора; заголовок меню: один тип из списка; шаг только если без него нельзя; факт в контексте — `TEXT`; лишний шаг хуже, чем сразу ответить;
   - `stop` — `true` (конец ветки) или лейбл кнопки (wait + APPROVE); копируется в `block.stop`;
   - `container: true` → у блока `items: []`;
   - кеш типов — `container.using_blocks` (в JSON, для возобновления). Тип пишется при успешном push (`push`, после `init === true`). `init` сбросил массив (`file`, `thought`) — не писать тип снова. `step` снимает себя в `todo`, когда текущий шаг закрыт. Новый `prompt` — `delete using_blocks`. Тип в окне один раз; меню пустое и нет `content` — узел с `close` (`total`);
   - `recalc` после стрима: `form` / `html` кладут разметку в `block.html`;
   - `approve(params)` — обработка `APPROVE` (`planning`, `form`, `report`);
   - `recalc(params)` — пересчёт узла: подпись `state` по типу, иконка, `mode` где нужно; `step.recalc` зовёт `todo.recalc` (label шага = `N. название`, иначе при push остаётся ярлык «Шаг»);
   - `init(params)` — ход узла до push. `true` — блок в ленту; не `true` — не пушить. Сервис (`search` / `read` / `file` / `write` / `web` / `site`) и `total` — свои `init`;
   - `close` — лист закрывает родителя (`total`): `init` пишет `container.content` и возвращает `false`, блок не пушится. В `_container_context` узлы `close` не идут в messages. Пустое меню + нет `content` — харнесс берёт `pipe[id].close`, не имя типа;
   - `fallback` — узел дрифта, если выбор модели не из меню (`text`);
   - `icon` — спокойная иконка в JSON; живая — только UI (`typeIcon` / `streamTarget`); `service` — путь сервиса у `web`; `role`, `build` — где заданы;
   - `done.next` — куда идти, когда контейнер уже с `content`. Нет `done.next` — меню родителя. Лист без своего `next` (`site`) — тоже родитель.
4. **Позиция автомата:**
   - `_active_container()` — спуск в `items.last`, пока у узла есть `items` и нет `content`;
   - `_active_block()` — если у контейнера незакрытый `todo` (шаг без `content` или шагов меньше плана), то `todo`; у `includes` — непрочитанный `file` или сам контейнер, пока список `files` не исчерпан; иначе `items.last` или контейнер. Назад по ленте не ходим: только вперёд или вверх.
5. **Один шаг `prompt()` после входа:**
   - `pipe[block.type].init?` — если вернул не `true`, блок не пушится. Сервис зовёт `init`, не стрим. `search` / `read` / `file` / `write` / `web` / `site` — свои `init`. Узел с `init` после push не стримится — сначала `init`;
   - иначе если не контейнер и нет `content` — `_streamChat` (лист: свой `prompt`). Контейнер не стримится; `total` закрывает родителя своим `init`;
   - иначе меню `next`: свой `next` важнее `content`; закрытый контейнер без `done.next` — меню родителя; лист без `next` — родитель; типы в `using_blocks` — нет; меню пустое и нет `content` — узел с `close` (`total`); у `task` без текста `prompt` — только `question`; пустое меню при уже закрытом контейнере — `chat.done`;
   - пушит блок (без `system` на блоке). Нет стрима и это контейнер — внутрь (`prompt({ role: 'AI' })`). Иначе `_streamChat`;
   - `parse?`, `recalc`. У `total` (`close`): `prompt` родителя → `container.content`, лист не пушится. Auto-loop: `!block.stop` → `prompt({ role: 'AI' })`. `chat.done` — когда автомат остановился.
6. **Атомы `web` / `site`** (как `todo` / `step`):
   - `web` — поиск: сервис `/SERVICES/DuckDuckGo` (`search` + `fetch_url`). Путь сервиса — на узле (`web.service`), в JSON блока не копируется. `system` от `plan`/`do`, `next` = `site`. Запрос — `webQuery`: свой `label` (не ярлык «Интернет»), иначе текст `prompt`. Без запроса / пустая выдача / ошибка сервиса — `state: 'error'` + `content` на `web`, `site` не создаётся. `label` остаётся «Интернет». `web.sites` — `{ url, title }` из выдачи. В окне один `site`. `state` — `Сайты` успешные/всего (ошибка не затирается). В сводку — **Источники**;
   - `site` — один живой на окно. `init`: url из `sites` контейнера, `WORK.get_item(web.service).fetch_url` → `block.page` с меткой `[site N: url]`; нет url / ошибка/пусто → `error` + `content`. Разбор — `_streamChat`; метку в `content` ставит `stampSiteContent`. `label` — hostname.
7. **Атомы `work` / `search` / `read` / `write`:**
   - `work` — контейнер. Меню `plan`: `search`, `read`, `total`; `do`: + `write`. Закрытие — `total`;
   - `search` — `run`: `semantic_search` по запросу (`workQuery`). `content` — список путей. `label` = запрос;
   - `read` — `run`: путь из блока / последнего search, `read_text`. `content` = текст (или короткая ошибка);
   - `write` — `init` пушит блок (`true`); стрим; `recalc` разбирает путь/текст и пишет `save` / `edit`.
8. **Атомы `includes` / `file`:**
   - как `todo` / `step`: чат и `prompt()` пишут список `includes.files` (`path`, `label`, `icon`), `items` пустой. Корневого `body.includes` нет;
   - пока список не прочитан — `next` = `file` (один в ленту). Файл закрыт (`content` или ошибка) — снять `file` с кеша, следующий. Все готовы — `total`;
   - `prompt` — краткое изложение файлов, не отчёт по теме и не вопрос. Стрим только через `total`. `recalc` — `N/M Файл`;
   - `file` — лист: `run` берёт следующий из `files`, `icon` с `$file.icon`, `read_text()` → `content` с шапкой `[file: путь]`. Ошибка — `state: 'error'`, в `content` та же шапка и текст ошибки.
9. **Wait:** `block.stop` — `true` без кнопки (шапка скрыта) или строка-лейбл (action-bar + шапка, `role:'APPROVE'`, `accept`). После решения — `delete block.stop`. Лейбл кнопки с `stop` не сравнивают.
10. **Режимы и выбор:** шаг только если без него нельзя выполнить текущий запрос. Факт уже в контексте (лента, `location`, todo, итог) — `text`, не `explore`/`planning`. Дыра у пользователя — `question` / `form`. Внешних фактов нет — `explore`. Несколько несделанных действий — `planning`. Меню корня — `task.plan` / `task.do` (в обоих `report` — закрытие таска человеком). В `task` и `step` (`plan`/`do`) есть `question`. Внутренние площадки (`explore`, `work`, `web`, `includes`, `step`, `check`) — `total`. `explore` не меняет `mode`. `check` — площадка после `execute`, не выход. `execute` есть в `task.do`. Один `todo` на контейнер.
11. **Question / form / text:** один вопрос — `question` (`stop: true`, без кнопки). Ответ — следующий `prompt` в ленте, не `answer`. Нет цели — спросить, не искать в интернете. Два и больше вопроса — `form`. Только поля, без которых нельзя идти дальше. Ответ: один fenced-блок html (`form`+`fieldset`), после него пояснение 1–10 слов (в ленте `content` над формой). Выбор — только `select` + «Другое» + `input` (не radio/checkbox). Слот прячет ввод, пока «Другое» не выбрано. Скаляр — number/date. `parse` — fence / `<form>` / `fieldset`, хвост в `content`; срезает script, `oda-icon`, button/submit. Раскладка: один `legend` (имя поля, не путь); один select — без `label`; input «Другое» — свой name. `legend`/`label` могут начинаться с эмодзи. Никаких customElements. `text` — дрифт меню. `stop: true`.
12. **Html:** SPA в sandbox-`iframe` (`srcdoc`). `recalc` → `block.html` (fence или целый document в `content`); `stop: true` (конец ветки, без approve и auto-loop). Слот `microchat-html`, высота через `postMessage`.
13. **Report / total:** `report` — шаг корня / шага, `stop: 'Принять'`. `accept` без `prompt` → approved, `container.content = block.content`; иначе `rejected`. `total` — `close`, без своего `prompt`; `init` стримит `prompt` контейнера → `container.content`, возвращает `false`, лист не пушится. Новый блок `prompt` снимает `using_blocks` у контейнера.
14. **Контекст:** `_container_context(container)` — один слой: `system` из `pipe[container.type]` + `[todo]` + `items` как листья (узлы `close` не входят). У открытого `site` — `block.page` (уже с `[site N: url]`). Открытый контейнер без `content` — слот «Текущий этап далее (label).». `context()` — путь от корня + текущие дата/время (`timeNow` по `body.tz`) + режим. Место — в `body.system` с `on_save`, не каждый ход.
15. **Служебное:** `stop` — флаг `_stopped` (обрывает стрим и auto-loop); `change_model` — `body.model`; `remove_block` — вырезать блок из `items` родителя, снять тип с `using_blocks`, `_save` (не `on_save`); `_save` — JSON на диск + `session.send({ path })`; `_continue` — `_save` + auto-loop, если не `_stopped`.
16. UI — [`handlers/preview`](/$server/$folder/$file/$task/handlers/preview/$handler/class.js/~/handlers/pages/form/). `streamTarget` — focused без `content`/`html` (слот). `streaming` — только `chat.delta` / `chat.done`. `typeIcon`: вертушка на слоте и предках, только пока `streaming`; в JSON не пишется. Слот form только при `html`. `pinned` — `focusedBlock` и предки на пути; закрытая площадка не на пути сворачивается свободно. Sticky: одна поверхность. `todo`/`prompt` — host (`todo` = 0, `prompt` = высота todo), `summary` в потоке; контейнер — только `summary` (todo + соседний prompt + шапка родителя). Удаление блока — кнопка в шапке (ховер), `confirm()`, `fetch('remove_block')`; `todo` и живой слот стрима не удаляются. Wide (`≥720px`, есть отчёты): справа док (`oda-splitter`, ширина в localStorage); тот же `content` в ленте и в доке; инпут слева под лентой; copy/share в тулбаре дока.

## 4. Из чего это состоит

- [`class.js`](/$server/$folder/$file/$task/class.js/~/handlers/pages/form/) — харнесс: `prompt`, `context`, `_streamChat`, `_push_block`, `_build_block`, `_active_*`, `stop`, `change_model`, `remove_block`, `_save`; `this.pipe` = namespace `pipe.js`
- [`pipe.js`](/$server/$folder/$file/$task/pipe.js/~/handlers/pages/form/) — узлы `export const`, `includePlan` / `includeReal`; без объекта `PIPE`
- [`triggers/on_save/$trigger/`](/$server/$folder/$file/$task/triggers/on_save/$trigger/class.js/~/handlers/pages/form/) — system prompt + первый вход в цикл
- [`handlers/preview/$handler/`](/$server/$folder/$file/$task/handlers/preview/$handler/class.js/~/handlers/pages/form/) — микрочат (лента + док + panel)
- [`readme.md`](/$server/$folder/$file/$task/readme.md/~/handlers/pages/form/) / [`progress.md`](/$server/$folder/$file/$task/progress.md/~/handlers/pages/form/) — знания модуля

## 5. В каком это состоянии

**В активной доработке.** FSM в `pipe.js`, цикл в `class.js`. Сервис (`search` / `read` / `file` / `write` / `web` / `site`) — свой `init`. Стрим без tools.

- ✅ узлы — `export const` в `pipe.js`; корень `type: 'task'`; маршруты у контейнера (`plan`/`do` + `mode`)
- ✅ `content` = закрыто: спуск, меню `next`, `todo`/`step`, `report` (таск) / `total` (площадка)
- ✅ `prompt()`: `init` / меню → push → stream → `parse?` → `recalc` → auto-loop / wait по `stop`
- ✅ кеш типов — `using_blocks` на контейнере; закрытый `step` снимает себя; новый `prompt` сбрасывает массив
- ✅ стрим: лист — свой `prompt`; контейнер не стримится; `total` — `prompt` родителя. `system` площадки в JSON не пишется
- ✅ `planning.approve` → todo + `mode:'do'`
- ✅ `report.approve` → `state` / `container.content`; якорь после APPROVE через `_active_*`
- ✅ `html`: SPA в iframe, `recalc` → `block.html`, `stop` без approve/auto-loop
- ✅ `explore` / `work` / `web` / `includes` закрывает `total` (`close` + falsy `init` → `container.content`, лист не пушится)
- ✅ нет `fc` на узлах; `search` / `read` / `write` / `web` / `site` / `file` — свой `init`
- ✅ `site.content` — разбор страницы в md (факты по теме, без рекламы; ссылки, `![ ]` / видео из хвостов дампа), не дамп `fetch_url`
- ✅ тип в окне один раз; исчерпание → узел с `close` (`total`); `web.sites` — `{ url, title }`
- ✅ `work` — контейнер; атомы `search` / `read` / `write` со своим `run`
- ✅ вложения в ленте: `includes` + `file` в `items` (чат), чтение; закрытие — `total`
- ✅ `question` в меню `task` / `step`; без текста `prompt` в корне только `question`; `web.label` не запрос
- ✅ пустой search / нет url: `error` + `content` на блоке, не стрим и не пустой `site`
- ❌ Harness tools, `pendingAction`, subplan / spawn_agent

## 6. Дальнейшие планы

- Replan слота todo с учётом закрытых шагов
- Самоподтверждение модели (без `stop`)
- `execute` в `task.do` (`next` уже с `work` / `check` / `total`)
- Harness tools + ACL роли
