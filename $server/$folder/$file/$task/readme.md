# $task — тип файла ИИ-задачи (ai.task)

## 1. Что это

Тип `$task` — файловый носитель диалога и PDCA-цикла встроенного ИИ WORK (`ai.task`). Технически это JSON: корень `type: 'task'` + дерево `items` (+ опционально `todo`, `mode`, `system`, `model`); прикладно — панель управления задачей агента в зоне роли USER / BOSS / ADMIN.

Расширение `.task` (не `.ai`): у `mime-types` `.ai` = PostScript/Illustrator; каноническое имя файла — `ai.task`. `contentType: 'application/json'`.

## 2. Зачем это нужно

Даёт ИИ-управляющему единую точку: увидеть контекст пары user/class, спланировать работу, уточнить данные формой, выполнить шаги с подтверждением. Вход в цикл — через `triggers/on_save` (`file.prompt(params)`) или UI preview (`fetch('prompt'…)`).

## 3. Как это работает

Инвариант: нет `content` — блок живой (в него спускаемся); есть `content` — завершён. Листья получают `content` из `init` (сервис) или стрима (`_streamChat`). Внутренний box закрывает `total` (`close`): один блок-данные в боксе (`role: 'user'` у узла, `content`, не `error`) — `init` проталкивает только его `content` в box без LLM-пересказа и возвращает `false` (label родителя не трогать — иначе explore становится «Web: …»); несколько — стрим-сводка как раньше. Пересказ одиночного источника — токены и потеря провенанса (сводка без ссылок читается следующим слоем как «данные из ниоткуда»). Дубли проталкивания в доке снимает `dockReports` (skip по совпадению `content`). `report` — шаг корня (кнопка). Тот же признак у `step` (`todo.recalc` смотрит `st.content`). `state` — подпись сути в шапке (не фаза), сначала текст, потом число: `web` — `Сайты 2/2` (успешные / все `site` в ленте), `explore` — `Интернет 1, Форма 2`, `todo` — `2/5 Шаг`. APPROVE — тоже `state`.

1. **`on_save`** пишет `body.system` (SYSTEM + **выбор шага** + режимы `plan`/`do` + профиль / рабочая группа; если `path` совпал — один блок «личная зона»; место из `params.location` — точка и город, Nominatim). `body.tz` — пояс для часов. Поля `location` / `here` нет. Потом `file.prompt(params)` с `prompt: body.title`, роль как пришла. Старый таск держит старый `body.system`, пока снова не сработает `on_save`.
2. **Роли входа `prompt()`:**
   - default (USER/…) — текст есть — `{ type:'prompt', content }`; `post.files` — `save_files` у `$owner` и новый `{ type:'includes', files }` (старый закрытый `includes` не дополнять); пустой ввод без файлов — блок не создавать;
   - `APPROVE` — флаг `accept` (`true` / `'true'` = принять, иначе отказ). `prompt` — только нагрузка (поля формы). При accept: `approve(params)`, `_save`, пересчёт `_active_*` и обычный ход автомата;
   - `AI` — без нового user-блока (auto-loop / «Продолжить»); сбрасывает `_stopped`.
3. **Узлы** — именованные экспорты в [`pipe.js`](/$server/$folder/$file/$task/pipe.js/~/handlers/pages/form/) (`export const thinking`, `web`, …). Реестра `PIPE` нет. Харнесс грузит модуль целиком (`this.pipe`, не `importScript` / default) и берёт узел как `pipe[type]`. Хелперы якоря вложений — `export function includePlan` / `includeReal`. Корень файла — box `task` (`body.type ??= 'task'`). Метод `prompt()` не ветвится по `type`, кроме входа `prompt`.
   - `plan` / `do` → `{ next: [...] }` — маршруты box по `box.mode || 'plan'`; свой `next` блока важнее `content` (после `prompt` — `thinking` / `question` / `form` / `answer`: явные просьбы «спроси» / «сделай форму» доступны в один хоп); нет своего — меню box;
   - `prompt` — текст для модели. Лист — стрим сразу. Box — не стримить (даже если слот есть); текст идёт в `total` (`prompt` родителя). `system` / `plan.system` / `do.system` в JSON не копируется;
   - `inject` — критерий входа «когда брать» в меню выбора (не намерение: у `answer` — «факты в контексте — ответь», у `question` — «нет данных/доступа у системы; default в контексте — не сюда», у `explore` — «внешних фактов нет; не для известного кода», у `activation` — «do: артефакт/код/файлы, не поиск», у `planning` — «несколько действий; факты есть — answer», у `thinking` — «только если есть задача»); заголовок меню: один тип из списка; шаг только если без него нельзя; факт в контексте — `TEXT`; лишний шаг хуже, чем сразу ответить. Silent-вызовы (`меню`, шапка 2–3 слова) — `temperature: 0` и `effort: 'off'` (`think: false` у Ollama): слово меню в `content`, без CoT;
   - `stop` — `true` (конец ветки) или лейбл кнопки (wait + APPROVE); копируется в `block.stop`;
   - `box: true` → у блока `items: []`;
   - кеш типов — `box.using_blocks` (в JSON, для возобновления). Тип пишется при успешном push (`push`, после `init === true`), кроме `ignore`. `init` сбросил массив (`file`, `thought`) — не писать тип снова. `step` снимает себя в `todo`, когда текущий шаг закрыт. Новый `prompt` — `delete using_blocks`. Тип в окне один раз; меню пустое и нет `content` — узел с `close` (`total`);
   - `block.menu` — тот же текст, что ушёл в выбор шага (`TYPE - inject`); в контекст модели как поле блока не входит;
   - `recalc` после стрима (успешный push) и в `total.init` после `box.content` (узел коробки). Тело блока — только `content`; вид — по `type` (`html` — iframe, `form` — слот из fence в `content`, иначе md). Шапка: если `label` ещё ярлык типа — silent `_streamChat` только на `content` + промпт «2–3 слова», без `context()`. Свой label (`web` / `site` / `step` / `file` / `search`) не трогать;
   - `approve(params)` — обработка `APPROVE` (`planning`, `form`, `report`);
   - `recalc(params)` — пересчёт узла: подпись `state` по типу, иконка, `mode` где нужно; `step.recalc` зовёт `todo.recalc` (label шага = `N. название`, иначе при push остаётся ярлык «Шаг»);
   - `init(params)` — ход узла до push. `true` — блок в ленту; не `true` — не пушить. Сервис (`search` / `read` / `file` / `write` / `web` / `site`) и `total` — свои `init`;
   - `close` — лист закрывает родителя (`total`): один успешный источник — проталкивание + снятие `error`/`state`; одни `error` — `box.error` + их `content`/`state` в шапку, без LLM (иначе «инструментов нет»); несколько успехов — стрим-сводка, у родителя снимаются `error`/`state` (частичные фейлы site не держат шапку). `false`, лист не пушится. Пустое меню + нет `content` — `total`; есть `box.content` — общий `chat.done`, без меню;
   - `fallback` — узел дрифта, если выбор модели не из меню (`text`);
   - `ignore` — блок в ленте, автомат его не видит: не в `next`, не в `context()`, не в `using_blocks`, `_active_block` перешагивает. Узел `reasoning` — живой слот CoT обычного стрима: пуш на первый чанк, вырез из бокса пуша по концу. Silent — CoT не создаёт слот, `effort: 'off'`. Меню — только `content`; пусто — `thinking`, если он в оставшихся `next`, иначе `next[0]` (первый среди оставшихся после `using_blocks`). `thinking` — шаг из меню, текст в контексте;
   - `icon` — спокойная иконка в JSON; живая — только UI (`typeIcon` / `streamTarget`); `service` — путь сервиса у `web`; `role` — роль блока в контексте (данные — `user`, речь — `assistant` по умолчанию); `expand` — закрытый box отдаёт в контекст листья, не `content`; `doc` — врождённый признак дока отчётов (`explore`, `file`, `web`, `execute`, `check`, `planning`, `report`, `html`), копируется в блок из `_build_block`; динамически флаг не ставится; `build` — где задан;
   - `done.next` — куда идти, когда box уже с `content`. Нет `done.next` — меню родителя. Лист без своего `next` (`site`) — тоже родитель.
4. **Позиция автомата:**
   - `_active_box()` — спуск в `items.last`, пока у узла есть `items` и нет `content`;
   - `_active_block()` — если у box незакрытый `todo` (шаг без `content` или шагов меньше плана), то `todo`; у `includes` — непрочитанный `file` или сам box, пока список `files` не исчерпан; иначе последний не-`ignore` или box. Назад по ленте не ходим: только вперёд или вверх.
5. **Один шаг `prompt()` после входа:**
   - `pipe[block.type].init?` — если вернул не `true`, блок не пушится. Сервис зовёт `init`, не стрим. `search` / `read` / `file` / `write` / `web` / `site` — свои `init`. Узел с `init` после push не стримится — сначала `init`;
   - иначе если не box и нет `content` — `_streamChat` (лист: свой `prompt`). Box не стримится; `total` закрывает родителя своим `init`;
   - иначе меню `next`: свой `next` важнее `content`; закрытый box без `done.next` — меню родителя; лист без `next` — родитель; типы в `using_blocks` — нет; меню пустое и нет `content` — узел с `close` (`total`); у `task` без текста `prompt` — только `question`; пустое меню при уже закрытом box — `chat.done`;
   - пушит блок (без `system` на блоке). Нет стрима и это box — внутрь (`prompt({ role: 'AI' })`). Иначе `_streamChat`;
   - `parse?`, `recalc`, шапка 2–3 слова (silent, если label ещё ярлык типа). У `total` (`close`): `prompt` родителя → `box.content` → `recalc` коробки → шапка, лист не пушится. Auto-loop только если нет `box.content` и (`block.box` или нет `block.stop`). Иначе общий `chat.done`.
6. **Атомы `web` / `site`** (как `todo` / `step`):
   - `web` — если в последнем prompt есть `http(s)://` — `sites` из этих URL, поиск не зовётся (явная ссылка важнее выдачи). Иначе до 3 вариантов запроса от модели (`searchQueries`), race по `web.services`. `fetch_url` для `site` — `web.service` (DuckDuckGo). Пусто — `error: true`; потолок 3 error-`web`. В сводку — **Источники**; после LLM-`total` в `content` дописываются `![…](url)` из успешных `site` (раздел «Медиа»), чтобы картинки не терялись в пересказе;
   - `site` — URL из последнего prompt (ещё не открытый) важнее очереди `box.sites`; иначе первый невзятый из `sites`. Нет url — `false` (в `using_blocks` остаётся `site` → меню только `total`). Ошибка/пусто — `error` на листе; `box.error`/`state` ошибки — только если ещё нет успешного site (иначе прогресс `сайты: N/M`). Успех снимает `box.error`. После захода: пока есть непрочитанный URL и успешных site &lt; 3 — `delete using_blocks` (site снова); иначе `using_blocks = ['site']` → принудительный `total` (не вычитывать всю выдачу). `label` — hostname.
7. **Атомы `work` / `search` / `read` / `write`:**
   - `work` — box. Меню `plan`: `search`, `read`, `total`; `do`: + `write`. Закрытие — `total`;
   - `search` — `run`: `semantic_search` по запросу (`workQuery`). `content` — список путей. `label` = запрос;
   - `read` — `run`: путь из блока / последнего search, `read_text`. `content` = текст (или короткая ошибка);
   - `write` — `init` пушит блок (`true`); стрим; `recalc` разбирает путь/текст и пишет `save` / `edit`.
8. **Атомы `includes` / `file`:**
   - как `todo` / `step`: чат и `prompt()` пишут список `includes.files` (`path`, `label`, `icon`), `items` пустой. Корневого `body.includes` нет;
   - пока список не прочитан — `next` = `file` (один в ленту). Файл закрыт (`content` или ошибка) — снять `file` с кеша, следующий. Все готовы — `includes.recalc` закрывает бокс маркером `[attachments] файлы: <имена через запятую>` без LLM-итога (`total` не участвует);
   - `expand: true` на узле: контекст берёт листья-отчёты `file` (каждый отдельным сообщением с ролью своего узла), не `box.content`; маркер в контекст не попадает. `state` вешает `file.init`: на `includes` — `файлы: N/M`, на лист — `reading` / `прочитан` / `ошибка`;
   - `file` — лист: `init` берёт следующий из `files`, `icon` / `label` / `path` с файла, тело в `draft` (текст или `image_url`) → стрим-отчёт с шапкой `file N: [label](path)`; промпт требует числа / таблицы / идентификаторы дословно. Ошибка — `state: 'ошибка'`, в `content` шапка и текст ошибки.
9. **Wait:** `block.stop` — `true` без кнопки (шапка скрыта) или строка-лейбл (action-bar + шапка, `role:'APPROVE'`, `accept`). После решения — `delete block.stop`. Лейбл кнопки с `stop` не сравнивают.
10. **Режимы и выбор:** шаг только если без него нельзя выполнить текущий запрос. Факт уже в контексте — `answer`/`text`, не повтор `explore`. Сделать код/html/файлы — `activation` → do → `execute`/`html`, не explore «на всякий случай». Дыра у пользователя — `question` / `form` (не вкус пресета при ясном default). Ясный default и план артефакта уже в контексте (включая thinking) — `activation`/`execute`, не `question`; stop-узлы — только когда без ответа человека продолжить объективно нельзя. Внешних фактов нет — `explore`. Несколько несделанных действий — `planning`. В `task.plan.next` activation раньше explore; в `do` — execute раньше explore. В `step.system` (todo): только текущий пункт; ответ человека — question/form; сводка в контексте — не второй explore/web. Меню корня — `task.plan` / `task.do` (в обоих `report`). В `task` и `step` есть `question`. Внутренние площадки — `total`. `explore` не меняет `mode`. `check` — после `execute`. Один `todo` на box. Принятый `report` → `mode: 'plan'` и `box.content`. Отклонённый `mode` не трогает.
11. **Question / form / text:** один вопрос — `question` (`stop: true`, без кнопки). Ответ — следующий `prompt` в ленте, не `answer`. Нет цели — спросить, не искать в интернете. Два и больше вопроса — `form`. Только поля, без которых нельзя идти дальше. Ответ в `content`: один fenced-блок html (`form`+`fieldset`), после него пояснение 1–10 слов (в ленте подпись над формой — хвост после fence, не отдельное поле). Выбор — только `select` + «Другое» + `input` (не radio/checkbox). Слот прячет ввод, пока «Другое» не выбрано. Скаляр — number/date. `parseFormHtml` — fence / `<form>` / `fieldset` из `content` (старый `block.html` — фолбэк); срезает script, `oda-icon`, button/submit. Раскладка: один `legend` (имя поля, не путь); один select — без `label`; input «Другое» — свой name. `legend`/`label` могут начинаться с эмодзи. Никаких customElements. Сдача: `approve` парсит values в `block.answer`, `block.approved` — читаемые пары «подпись: текст option» из разметки в `content` (`formFieldMeta`), пустые поля не пишутся; в контекст идёт `approved`, не сырой JSON. `text` — дрифт меню. `stop: true`.
12. **Html:** лист. Стрим в `content`; `recalc` снимает fence в тот же `content` (`unwrapFence`), поле `html` не пишется. Слот `microchat-html` (`srcdoc`, sandbox), высота через `postMessage`. Без approve; auto-loop дальше по меню `execute`.
13. **Report / total:** `report` — шаг корня / шага, `stop: 'Принять'`. `accept` без `prompt` → approved, `box.content`, `mode: 'plan'`. Иначе `rejected`. `total` — `close`; `init` стримит `prompt` box → `box.content` → `recalc` коробки → шапка 2–3 слова, `false`. Новый `prompt` снимает `using_blocks`.
14. **Контекст:** `_box_context(box, focus, evidence)` — один слой: `system` из `pipe[box.type]` + `[todo]` + `items` (узлы `close` / `ignore` не входят; `error: true` — в обычный контекст входят, чтобы меню видело «страница недоступна»; в `total` с `evidence: false` — нет, чтобы не тащить заголовок-ошибку в сводку). CoT `reasoning` только на время стрима. В `context()` к system каждый ход дописывается карта из `pipe` (без хардкода имён): `[задача]` = `task[mode].next` + inject; `[далее]` = next текущего бокса минус `using_blocks` (если отличается от корня). Пополнили pipe — карта сама. Меню выбора — только «одно слово из списка», без «просто отвечай». Роль сообщения — из узла (`role`): данные (`includes` / `file` / `web` / `site` / `search` / `read`) — `user`, речь — `assistant` (дефолт). Фокусный слой (последний открытый box) — все блоки с `content`; слои-предки — рамка: `prompt`-блоки, закрытые боксы (улики), сдача формы (`b.approved`, фолбэк `b.answer`); речь ассистента предков не входит. `expand`-box (`includes`) отдаёт листья вместо `box.content`. Генерация `total` — `evidence: false`: предки без уликов-боксов, чтобы итог этапа не пересказывал чужие сводки. У открытого `site` — `block.page` (уже с `[site N: url]`). Открытый box без `content` — слот «Текущий этап далее (label).». `context()` — путь от корня + текущие дата/время (`timeNow` по `body.tz`) + режим. Место — в `body.system` с `on_save`, не каждый ход.
15. **Служебное:** `stop` — флаг `_stopped` (обрывает стрим и auto-loop); `change_model` — `body.model`; `remove_block` — вырезать блок из `items` родителя, снять тип с `using_blocks`, `_save` (не `on_save`); `_save` — JSON на диск + `session.send({ path })`; `_continue` — `_save` + auto-loop, если не `_stopped`.
16. UI — [`handlers/preview`](/$server/$folder/$file/$task/handlers/preview/$handler/class.js/~/handlers/pages/form/). `streamTarget` — focused без `content` (слот). `streaming` — только `chat.delta` / `chat.done`. `pending` — `chat.start` (вход `prompt`) … `chat.done` (выход); на set — `chatPending`. `typeIcon`: вертушка при `pending` и пустом `content`; в JSON не пишется. Слот form — разметка из `content` (fence). `pinned` — `focusedBlock` и предки на пути; закрытая площадка не на пути сворачивается свободно. Sticky: одна поверхность. `todo`/`prompt` — host (`todo` = 0, `prompt` = высота todo), `summary` в потоке; box — только `summary` (todo + соседний prompt + шапка родителя). При `stop: true` `title` на `details` = `data.menu`. Без времени и удаления в шапке. Есть отчёты: справа док (`oda-splitter`); тот же `microchat-view-*` с `onlyDoc` (без шапки и детей); инпут слева под лентой; copy/share в тулбаре дока.

## 4. Из чего это состоит

- [`class.js`](/$server/$folder/$file/$task/class.js/~/handlers/pages/form/) — харнесс: `prompt`, `context`, `_streamChat`, `_push_block`, `_build_block`, `_active_*`, `stop`, `change_model`, `remove_block`, `_save`; `this.pipe` = namespace `pipe.js`
- [`pipe.js`](/$server/$folder/$file/$task/pipe.js/~/handlers/pages/form/) — узлы `export const`, `includePlan` / `includeReal`; без объекта `PIPE`
- [`triggers/on_save/$trigger/`](/$server/$folder/$file/$task/triggers/on_save/$trigger/class.js/~/handlers/pages/form/) — system prompt + первый вход в цикл
- [`handlers/preview/$handler/`](/$server/$folder/$file/$task/handlers/preview/$handler/class.js/~/handlers/pages/form/) — микрочат (лента + док + panel)
- [`readme.md`](/$server/$folder/$file/$task/readme.md/~/handlers/pages/form/) / [`progress.md`](/$server/$folder/$file/$task/progress.md/~/handlers/pages/form/) — знания модуля

## 5. В каком это состоянии

**В активной доработке.** FSM в `pipe.js`, цикл в `class.js`. Сервис (`search` / `read` / `file` / `write` / `web` / `site`) — свой `init`. Стрим без tools.

- ✅ узлы — `export const` в `pipe.js`; корень `type: 'task'`; маршруты у box (`plan`/`do` + `mode`)
- ✅ `content` = закрыто: спуск, меню `next`, `todo`/`step`, `report` (таск) / `total` (площадка)
- ✅ `prompt()`: меню только если нет `box.content`; push → stream → `recalc` → шапка 2–3 слова (silent) → auto-loop / wait / общий `chat.done`
- ✅ кеш типов — `using_blocks` на box; закрытый `step` снимает себя; новый `prompt` сбрасывает массив
- ✅ стрим: лист — свой `prompt`; box не стримится; `total` — `prompt` родителя. `system` площадки в JSON не пишется
- ✅ `planning.approve` → todo + `mode:'do'`
- ✅ `report.approve` → `box.content` + `mode:'plan'`; меню не берётся; общий `chat.done`
- ✅ `html`: SPA в iframe из `content` (`unwrapFence`), без поля `html`; `stop` без approve/auto-loop
- ✅ `explore` / `work` / `web` закрывает `total` (`close` + falsy `init` → `box.content`, лист не пушится); `includes` — `recalc`-маркер + `expand`, без LLM-итога
- ✅ нет `fc` на узлах; `search` / `read` / `write` / `web` / `site` / `file` — свой `init`
- ✅ `site.content` — разбор страницы в md (факты по теме, без рекламы; ссылки, `![ ]` / видео из хвостов дампа), не дамп `fetch_url`
- ✅ тип в окне один раз; исчерпание → узел с `close` (`total`); `web.sites` — `{ url, title }`
- ✅ `work` — box; атомы `search` / `read` / `write` со своим `run`
- ✅ вложения в ленте: `includes` + `file` в `items` (чат), чтение; закрытие — маркер `includes.recalc`, в контекст идут отчёты `file` (роль `user`)
- ✅ `question` в меню `task` / `step`; без текста `prompt` в корне только `question`; `web.label` не запрос
- ✅ пустой search / нет url: `error` + `content` на блоке, не стрим и не пустой `site`
- ❌ Harness tools, `pendingAction`, subplan / spawn_agent

## 6. Дальнейшие планы

- Replan слота todo с учётом закрытых шагов
- Самоподтверждение модели (без `stop`)
- `execute` в `task.do` (`next` уже с `work` / `check` / `total`)
- Harness tools + ACL роли
