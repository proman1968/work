# Прогресс: $task

## Последние изменения
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
- Решение: side после write/create закрывает агент `check` (exist/meta → `goalDone`); work не зовёт `goalDone`; повтор create того же path — skip. Причина: create ok без постусловия → петля/зависание.
- Решение: подключение модели / новый класс — work.`create` → `$class.create`, не write/`save_file`. Причина: класс = тип + meta/class.js; файл с «:» в имени — ложный путь.
- Решение: после approve плана — не fill `todo`, сразу `step`. Причина: иначе цикл стопорится на пустом стриме чеклиста, «Продолжить» бессмысленна.
- Решение: goal v2 — system-норма + `resume.continue` + pursue (как у OpenCode: ориентация в system и внешний цикл, закрытие только evidence). Причина: одной записи goal.text недостаточно против терминального answer.
- Решение: `body.goal` — объект цели сессии; последняя реплика при open/waiting — вход к цели, не новая постановка; `live.wait` (activation) не дублируется resume-слотом. Причина: связать вопрос человеку с продолжением агента после leaf-stop.
- Решение: system в handoff — от заказчика (`body.system` role=system); исполнитель дополняет (place / agent.system), не пересобирает базу с нуля. Причина: иначе теряется расположение и прочий контекст заказа.
- Решение: стоп лист-агентов (question/form/planning/report) — прежний путь APPROVE/prompt таска; `live.wait` — только для стопов инструментов внутри бокса (activation). Причина: approve-хуки живут у владельца ленты (pipe/todo), поведение UI не меняется.
- Решение: строгие `model` с агентов сняты — все работают на модели задачи (`body.model`), дефолт для standalone — `$class/ai/config.js`. Приоритет `agent.model` в движке сохранён как механизм точечной привязки через наследование. Причина: слабая модель агента (gemma 4b) портила качество внутри задачи.

## Блокеры / Открытые вопросы
- Рестарт сервера обрывает `live.wait` — восстановление через block-continue (`_activeAgentBlock`), активация переигрывается.
