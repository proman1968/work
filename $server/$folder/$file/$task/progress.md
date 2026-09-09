# Прогресс: $task

## Последние изменения
- [17:56] Html в доке — iframe `inset: 0` в лист (не flex). Лента: `50vh` только до замера. Причина: flex+`100vh` снова разгонял док; в ленте оставался скролл.
- [17:50] Док — лист `only-doc` (`--content` на панель). Html: док `fill` без ping; лента — замер контента, не `100vh`. Причина: дырка по тексту; сапёр разгонял скролл.
- [17:25] Меню: «запомни / навык / рецепт» → `freeze`. `execute({ task })` — черновик читает ленту. Причина: навык из удачного прогона, не ручной файл.
- [17:15] `_canLoop`: `stopOnError` на агенте — после ошибки бокса не крутить меню. Причина: 1788962655786 — image 404, затем html.
- [16:57] Меню: «нарисуй» → `image`; evidence `image`/`generate` ведёт на check. Причина: 1788960700166 — картинка ушла в chat-модель.
- [15:14] В боксе-агенте промпт не сбрасывает `using_blocks`. Причина: правка activation заново жгла read несуществующего счёта.
- [15:00] Промпт вместо APPROVE на `live.wait`: `_reviseWait` — снять wait, текст в движок, не `do`. Причина: 1788954844440 — «Счет 01» при activation 20, лента молчала.
- [14:30] Навык: `ai/skills/` на новой цели (`@id` / `when`+phrases) → `body.skill`, ходы `pipe` вместо меню; в `context` блок `[skill]`; движок — `skillStep`. Причина: рецепт ленты, не спонтанный pick.
- [14:05] Шапка: один слот `linkHtml` (path | url). Причина: два span никогда не активны вместе.
- [13:50] Шапка: attrs ODA `no-flex`/`flex` (без своих flex/max-width/цвета ссылки); путь `~if`+`~html`. Причина: кастомный flex резал лейблы, `no-flex` не работал, ссылка выглядела чужим чипом.
- [13:40] Ссылки в шапке: `~html` + `pathLinkHtml`/`urlLinkHtml` (не `:href` на `<a>` — пустой узел). Причина: DevTools `<a class="path"></a>` без href/текста.
- [13:35] Шапка: `.path` не схлопывается (`flex: 1`, `min-width: 8ch`); type/state не забирают всю ширину. Причина: ссылки в DOM были, на экране — 0px.
- [13:30] Шапка ссылок: `$this.host.blockPath` / `blockUrl` (не `data`/`pathText` в with($pdp) — ReferenceError). Причина: ODA has-trap.
- [13:25] Шапка: ссылки только через `data.path` / `data.url` в шаблоне (без pathText/linkHref в ~if). Причина: ODA with($pdp) ReferenceError.
- [13:20] Шапка: ссылки через `pathText`/`url` (два `<a>`), без `linkHref` в ~if — ODA ReferenceError. Причина: reactor throttle linkHref is not defined.
- [13:05] Шапка блока: русский label + кликабельный path/url (form / `_blank`). Причина: дубль type+label.
- [12:50] UI шапка блока: явный **type** + path + state (иконка остаётся). Причина: type читался только из иконки.
- [12:25] check: без сверки model/label — только факт create/write. Причина: 1788858416648 — ложный gap → web.
- [12:05] work.create batch (N за ход), dropUsed только при прогрессе; explore в док. Причина: 1788857474018 — create ×6 одного path.
- [11:45] движок: `init===false` сжигает тип в боксе (меню сужается); work.read — путь через fill. Причина: 1788856240964 — петля pick(read) после activation.
- [11:20] work: create/write → doc-артефакты (ссылки + тела) в ленте/доке. Причина: 1788854841637 — финал был только check checklist.
- [11:05] create: unique model у родителя; work без ignore+dropUsed; readme полный. Причина: 1788853754988 — три id на один model.
- [10:50] meta_file await files; readme → meta_folder.save_file. Причина: 1788852757790 — meta crash, readme не там.
- [10:25] check: meta/match + readme; work create пишет readme.md. Причина: соответствие задаче + документ точки.
- [10:10] check: `targets` → exist все; goalDone только полное покрытие; enrichTotal. Причина: 1788850832971 — один ok закрыл goal, дубль exist в UI.
- [10:00] check: путь с пробелами; без ignore; после ok → total/goalDone. Причина: 1788850024575 — петля exist на урезанном path.
- [09:40] меню: не «work затем check»→planning; next только id из pipe; `_agentsDir` = пакет движка; `_fillLeaf` без crash. Причина: 1788848860757 — plan вместо explore, step→total, question undefined.prompt.
- [18:20] агент `check` (exist/meta → goalDone); work без goalDone; create skip если path уже в run или на диске. Причина: 1788793771061 — create ok×3, зависание без проверки.
- [17:45] `looksLikeFileId`: пробел → не файл; расширение с буквы (не `.8b`). Причина: create `Exaone3.5 7.8b` ложно как save_file (1788791644492).
- [17:30] work create/write: `ignore` (повтор в одном work); `total` — склейка однотипных успехов без LLM. Причина: 1788791085346 — первый create ok, create сожжён в using → search/зависание, второй класс не создан.
- [17:20] work write/create: `role: 'user'` — evidence в `total` (один успех → без LLM-отчёта, finish/goalDone). Причина: 1788789434654 — create ok, зависание на fill total.
- [16:35] work.`create`: `$class.create` (родитель/тип/id/class.js); activation+do; goalDone; меню «подключи модель». Причина: прогон 1788787437798 — «добавь llama3.2:3b» думал файлом и search.
- [16:15] `goal.status=done`: нет «Продолжить» в панели; `role:AI` no-op. Причина: 1788786397438 — после facts-settle explore кнопка тянула лишний answer «нет фактов».
- [15:50] `goal.need`: silent menu facts|side (`_classifyGoalNeed`), без языковых regex. Причина: прогоны с `need:side` на вопросе; эвристика по словам не универсальна.
- [15:20] `goal.need` facts|side: классификация постановки; facts закрывается evidence сбора/реплики (`_settleFactsGoal`), без pursue; side — прежний pursue + `goalDone` от write. Причина: прогон 1788782057680 — верный explore, затем лишний work/search при open goal.
- [01:40] `_promptTurn`: `box.todo` не fill-лист; при незакрытых steps сразу `step` (не стоп после APPROVE плана). Причина: прогон — после «принято» fill todo → chat.done, «Продолжить» в том же тупике, steps не стартовали.
- [00:05] `_runAgent`: перед `execute` снова `engine.$context = this.$class` (общий tilde-метод). Причина: после work → web падение `meta_folder` of undefined.
- [22:05] goal v2: норма достижения в `[goal]` system; `resume.continue` после question без субагента (меню без answer); pursue до 3 ходов после терминального answer при open goal. Причина: прогон 1788718219280 — answer «сохранил» при живой goal и question до work.
- [21:05] `body.goal` + resume: сессионная цель (text/status/resume); waiting на question/form → resume агента; меню и context видят `[goal]`; `live.goalDone` после write.done. Причина: модель отвечала на каждую реплику как на новую задачу вместо добивания постановки.
- [19:35] `live.wait`: при ожидании человека шлём `chat.done` (кнопка APPROVE, pending гаснет); после APPROVE+`_resolveWait` не шлём done — исходный prompt ещё крутит движок (его start на APPROVE держит pending). Причина: дедлок activation — радуга и нет «Перейти к действиям».
- [11:25] `_runAgent` больше не передаёт `$context` в движок — класс исполнения у метода через `this.$context`.
- [20:55] `context({handoff})` снова передаёт system заказчика (`body.system` → `messages[0]`), без topicsMap/ролей ходов; исполнитель дополняет локально. Причина: пустой system у агента терял расположение (Рязань).
- [15:20] handoff не кладёт system в user-кадр (сбивало web). База system — от заказчика role=system; не пересборка с нуля.
- [14:35] Агенты исполняются движком класса (`~/ai prompt.$method`) через `_runAgent`: блок пушится в ленту, движку передаются `live` + `context({handoff})` + model/effort/tz. Причина: схлопывание двух реализаций в одну.
- [14:35] pipe-loader: агенты — декларации из меты класса (`ai/agents` через `$class.meta_folder`), тёзки ходов оркестратора пропускаются; каталог `$task/agents/*` удалён. Причина: канон агентов — `$class/ai/agents`, дубли рвут наследование.

## В работе
- Полное сведение `_streamChat`/`_fillLeaf` собственных ходов таска на движок (сейчас — только агенты).

## Ключевые решения
- Решение: `goal.done` терминален для AI-continue (панель + `prompt` role=AI). Причина: иначе «Продолжить» после evidence снова крутит меню и портит итог.
- Решение: `goal.need` — слот facts|side; классификация тем же silent-menu, что выбор хода (не словарь языка). Закрытие — по типу evidence. Причина: информационные и side-effect цели нельзя закрывать одним правилом; regex по постановке ломает универсальность.
- Решение: side закрывает `check`: targets → exist + meta (class.js) + readme (класс) / content (файл); без сверки device.model. Причина: «путь есть» недостаточно; предметные поля — не роль общего check.
- Решение: подключение модели / новый класс — work.`create` → `$class.create`, не write/`save_file`. Причина: класс = тип + meta/class.js; файл с «:» в имени — ложный путь.
- Решение: после approve плана — не fill `todo`, сразу `step`. Причина: иначе цикл стопорится на пустом стриме чеклиста, «Продолжить» бессмысленна.
- Решение: goal v2 — system-норма + `resume.continue` + pursue (как у OpenCode: ориентация в system и внешний цикл, закрытие только evidence). Причина: одной записи goal.text недостаточно против терминального answer.
- Решение: `body.goal` — объект цели сессии; последняя реплика при open/waiting — вход к цели, не новая постановка; `live.wait` (activation) не дублируется resume-слотом. Причина: связать вопрос человеку с продолжением агента после leaf-stop.
- Решение: system в handoff — от заказчика (`body.system` role=system); исполнитель дополняет (place / agent.system), не пересобирает базу с нуля. Причина: иначе теряется расположение и прочий контекст заказа.
- Решение: стоп лист-агентов (question/form/planning/report) — прежний путь APPROVE/prompt таска; `live.wait` — только для стопов инструментов внутри бокса (activation). Причина: approve-хуки живут у владельца ленты (pipe/todo), поведение UI не меняется.
- Решение: строгие `model` с агентов сняты — все работают на модели задачи (`body.model`), дефолт для standalone — `$class/ai/config.js`. Приоритет `agent.model` в движке сохранён как механизм точечной привязки через наследование. Причина: слабая модель агента (gemma 4b) портила качество внутри задачи.

## Блокеры / Открытые вопросы
- Рестарт сервера обрывает `live.wait` — восстановление через block-continue (`_activeAgentBlock`), активация переигрывается.
