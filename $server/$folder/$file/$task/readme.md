# $task — длинная ИИ-сессия (ai.task)

## 1. Что это

Тип `$task` — JSON-носитель длинного диалога/PDCA (`ai.task`): `type: 'task'` + `items` (+ `todo`, `mode`, `system`, `model`, `goal`) и **session-`prompt`** на самом типе файла.

Расширение `.task`. `contentType: 'application/json'`.

## 2. Зачем это нужно

Сохранить ленту, todo, цель (`goal`), модель и history между заходами; UI preview. Короткий one-shot между классами без файла — [`$class/ai`](/$server/$folder/$class/ai/readme.md/~/handlers/pages/form/) (`?prompt`).

## 3. Как это работает

1. **`class.js`** — session harness на типе: `prompt` / `stop` / `change_*` / `remove_block` / `pipe` / `body` / `model`.
2. **`pipe`**: `task.js` из tilde (ходы оркестратора) + декларации агентов из меты класса (`$class.meta_folder` → `ai/agents`, канон движка). Тёзки ходов оркестратора выше агентов.
3. **`body.goal`** — сессионная цель `{ text, status: open|waiting|done, resume, pursue }`. Новая постановка при отсутствии goal или `done`; иначе реплика — вход к открытой цели. В `context` — блок `[goal]` с нормой: пока не `done`, текст ≠ выполнение; side-effect только по факту в ленте.
4. **Resume / continue:** стоп `question`/`form` → `waiting` + `resume.agent` (если субагент уже был) или `resume.continue` (вопрос до агента). Следующий user-ход: форс агента либо меню **без `answer`**. `live.wait` (activation) не дублируется.
5. **Pursue:** терминальный `answer` при `goal` open → до `GOAL_PURSUE_MAX` авто-ходов без `chat.done` (меню снова, `answer` исключён). `done` только через evidence (`live.goalDone` после `write.done` и т.п.).
6. **Агенты исполняет движок класса** ([`prompt/$method`](/$server/$folder/$class/ai/prompt/$method/class.js/~/handlers/pages/form/)): таск пушит блок и передаёт `live` + `context({handoff})` — `body.system` + `[goal]` + диалог-улики (без topicsMap). Движок дополняет system локально (место, агент). Стоп инструмента (`live.wait`) → `chat.done` (кнопка APPROVE); ответ — `_resolveWait`, исходный prompt продолжает и сам закрывает сессию. Обрыв — `_activeAgentBlock`.
7. **`on_save`** пишет `body.system` (`buildSystemPrompt` из `prompt/$method`) и вызывает `file.prompt`.
8. UI: `parseFormHtml` / `unwrapFence` из локального [`task.js`](task.js).

## 4. Из чего это состоит

- [`class.js`](class.js) — session prompt, оркестратор ленты, контракт `live` для движка агентов
- [`task.js`](task.js) — оркестратор (`tools` / ходы) + хелперы UI
- [`triggers/on_save/`](triggers/on_save/$trigger/class.js) — system + первый prompt
- [`handlers/`](handlers/) — preview микрочата
- [`readme.md`](readme.md) / [`progress.md`](progress.md)

## 5. Состояние

- ✅ Session-`prompt` на `$task/class.js`; агенты — движок `$class/ai` через `live`
- ✅ `body.goal` + resume/continue; pursue после answer; `live.goalDone` после write
- ✅ One-shot на `$class/ai`: `/BASE?prompt&agent=&prompt=`

## 6. Дальнейшие планы

- Свести собственные ходы таска (`_streamChat` / `_fillLeaf`) на движок `$class/ai`.
- Кросс-классовый запуск агентов (адресация чужого класса из процесса).
