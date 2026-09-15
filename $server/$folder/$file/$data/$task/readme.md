# $task — длинная ИИ-сессия (ai.task)

## 1. Что это

Тип `$task` — JSON-носитель длинного диалога/PDCA (`ai.task`): `type: 'task'` + `items` (+ `todo`, `mode`, `system`, `model`, `goal`) и **session-`prompt`** на самом типе файла.

Расширение `.task`. `contentType: 'application/json'`.

## 2. Зачем это нужно

Сохранить ленту, todo, цель (`goal`), модель и history между заходами; UI preview. Короткий one-shot между классами без файла — [`$class/ai`](/$server/$folder/$class/ai/readme.md/~/handlers/pages/form/) (`?prompt`).

## 3. Как это работает

1. **`class.js`** — session harness на типе: `prompt` / `stop` / `change_*` / `remove_block` / `pipe` / `body` / `model`.
2. **`pipe`**: `task.js` из tilde (ходы оркестратора) + декларации агентов из пакета движка (`_aiPackage` → `ai/agents`). Тёзки ходов оркестратора выше агентов. Правка меню / `goal` / фаз — этот тип [`class.js`](class.js), не файл `ai.task` в профиле. `includes` — ход человека (как prompt): открывает/возобновляет goal, дальше thinking/answer, без вопроса «что делать». `includes.expand` — листья в контекст с бюджетом (`clipContext`). Сырые вложения → сначала `thinking`. Картинка: `draft.type=image_url` (без base64 в JSON), байты в ход из `path` как vision-часть. `stop` не снимать: `true` — пауза без кнопки; строка — имя кнопки, пока блок в фокусе; новый prompt сам уводит фокус. Пустой fill — ошибка в ленте, `stop` остаётся. Меню: id + необязательное поручение субагенту в той же строке (`brief` блока).
3. **`body.goal`** — сессионная цель `{ text, status: open|waiting|done, resume, pursue, need }`. `need`: `facts` | `side`. При новой постановке — silent-классификация (`_classifyGoalNeed` → `facts`|`side`; сомнение → `side`). Без поля — как `side`. Фазы машины (не regex постановки): после успешного сборщика (`web`/`explore`/`logs`, в том числе внутри step) эти id, `report` и **`planning`** снимаются с `next`; `need=facts` — с `next` снимаются актёры (`work`/`image`/…) и `check`, факты в ленте → `answer`; `need=side` без сбора — с `next` снимаются актёры, ход **`explore`** (thinking не сбор); без act-evidence (create/write/work по **всему дереву**) — нет `check`; после act без ok `check` → ход `check`; `answer` без ok `check` цель не закрывает. «нарисуй / фото / по сезонам» — `asksImage`: с `next` снимается `work` (N generate у image, не write png). В `context` провал сборщика (`error` и `ok=0`) не улика, если тот же тип уже дал `content`. В `context` — блок `[goal]` с нормой по `need`.
3a. **`body.skill`** — надетый рецепт из [`ai/skills/`](/$server/$folder/$class/ai/skills/readme.md/~/handlers/pages/form/) `{ id, cursor, slots }`. На новой цели: `@id` или `when.need`+`phrases` (одно попадание сразу, несколько — меню `none`|`id`). Нет `points` — не надевать. `_promptTurn` берёт `pipe[cursor].type` вместо меню; движок получает `skillStep` (system/prompt/tools). В `context` — блок `[skill]`.
3b. **Агент `freeze`** (`step: false`): после удачи меню «запомни / навык / рецепт» или `@freeze` → `ai/skills/{id}.js`. Не класть `freeze` в `pipe` навыка. `execute` передаёт `task` (лента + `_skillsDir`).
3c. **Агент `review`** (`step: false`): `@review` + претензия → диагноз (закон + слой + один `path`, откуда runtime читает). Не открывает новую goal. Файлы не пишет; правка — отдельная постановка / `@work` с этим path. Не в `pipe` навыка.
4. **Resume / continue:** стоп `question`/`form` → `waiting` + `resume.agent` (субагент с `step !== false`, не вложенный `site`) или `resume.continue` (вопрос до агента). Следующий ход человека — **текст в поле**, не кнопка. «Продолжить» (`role:AI`) только при `body.halt`: `stop` (кнопка Стоп) или `crash` (обрыв / error без штатного `stop`). `stop: true` с content (question/answer/report) — кнопки нет. `resume.continue` снимает с `next` `answer`/`form`/`question`. Форма в ленте: JSON живых контролов (`$pdp.result` с последней `form`, снимок **до** `pending`) и на APPROVE. `approve` пишет `answer` и `values`; с `using_blocks` снимаются `work`/`check`/`report`, чтобы переписать файл. `live.wait` (activation): строка `stop` на фокусе → кнопка APPROVE; текст в поле — тоже prompt (`_reviseWait` снимает waiter, `stop` на блоке не трогает, `do` не включать). Нет waiter (обрыв) — доиграть открытый бокс-агент (`_activeAgentBlock` по фокусу, не только по last). Промпт внутри открытого бокса-агента **не** чистит `using_blocks` (память read/create).
5. **Закрытие goal:** `need=facts` — `answer`/`report` → `done` (сборщики цель не закрывают). `need=side` — [`check`](/$server/$folder/$class/ai/agents/check.js/~/handlers/pages/form/) ok, затем `answer`/`report`/`html`; `_settleFactsGoal` **не** ставит `done` без ok `check` (в том числе если check ещё не было). Терминальный `answer` при open side → pursue. При `status=done` «Продолжить» нет (`halt` снят).
6. **Агенты исполняет движок класса** ([`prompt/$method`](/$server/$folder/$class/ai/prompt/$method/class.js/~/handlers/pages/form/)): таск пушит блок и передаёт `live` + `context({handoff})` — `body.system` + `[goal]` + диалог-улики (без topicsMap). Движок дополняет system локально (место, агент). Стоп инструмента (`live.wait`) → `chat.done` (кнопка APPROVE); ответ — `_resolveWait`, исходный prompt продолжает и сам закрывает сессию. Обрыв — `_activeAgentBlock`.
7. **План → todo → step:** `planning.approve` пишет `box.todo`; `_promptTurn` не стримит в todo — при незакрытых steps сразу пушит `step` (`pipe.todo.next`). Агент внутри step с `content` копируется на `step.content` — пункт `done`, следующий step, не второй агент в том же пункте.
8. **`on_save`** пишет `body.system` (`buildSystemPrompt` из `prompt/$method`) и вызывает `file.prompt`.
9. UI: `parseFormHtml` / `unwrapFence` из локального [`task.js`](task.js).

## 4. Из чего это состоит

- [`class.js`](class.js) — session prompt, оркестратор ленты, контракт `live` для движка агентов
- [`task.js`](task.js) — оркестратор (`tools` / ходы) + хелперы UI
- [`triggers/on_save/`](triggers/on_save/$trigger/class.js) — system + первый prompt
- [`handlers/`](handlers/) — preview микрочата; карточка чата — последний `doc` или последний блок; `~if`/`~is` reuse → `_reload` на `$item` / `changed` / `attached` (`load`, не снимок `log`)
- [`readme.md`](readme.md) / [`progress.md`](progress.md)

## 5. Состояние

- ✅ Session-`prompt` на `$task/class.js`; агенты — движок `$class/ai` через `live`
- ✅ `body.goal` + `need` (facts|side): фазы next; side → ok `check` затем answer; facts → answer после сбора
- ✅ `body.skill`: discover `ai/skills/`, выбор на новой цели, replay `pipe`
- ✅ агент `freeze`: лента → навык (`ai/skills/{id}.js`)
- ✅ агент `review`: `@review` → диагноз + слот path; не писатель
- ✅ `work.typed`: встреча / `$ics` (`when` + `METADATA`) → `save_file` на месте; нет фразы в цели — skip
- ✅ create/write act ищет по дереву ленты; после сборщика `planning` не в меню; шаг закрывается текстом агента
- ✅ One-shot на `$class/ai`: `/BASE?prompt&agent=&prompt=`
- ✅ «Продолжить» только `body.halt` `stop`|`crash`; штатный `stop: true` — кнопки нет
- ✅ `stop` не снимать: фокус = последний блок; строка `stop` — кнопка, пока он последний

## 6. Дальнейшие планы

- Свести собственные ходы таска (`_streamChat` / `_fillLeaf`) на движок `$class/ai`.
- Кросс-классовый запуск агентов (адресация чужого класса из процесса).
- Подключение модели в провайдер: tool `create` (`$class.create`) в пайплайне work — ✅ в [`agents/work.js`](/$server/$folder/$class/ai/agents/work.js/~/handlers/pages/form/).
