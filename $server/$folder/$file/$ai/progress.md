# Прогресс: $ai / task.ai

## Последние изменения

- [01:40] Починка живучести цикла и UI по итогам живого прогона (кнопка плана не появлялась, md не рендерился, крутилка зависала). 1) Двухтактный ход вынесен в `twoBeatMove`; `chat.done` шлётся ТОЛЬКО на wait-состояниях (`text`-маршрут, кнопки, опросы) — при слове-маршруте вместо него path-refresh + самовызов, спиннер живёт до конца цепочки. 2) `failTurn`: expect-ходы и двухтактный ход обёрнуты в try/catch — при сбое блок `error` в ленту + `chat.error` (клиент гасит спиннер), автомат не молчит. 3) `complete_step` убран из `RESEARCH_METHODS`; вызов `complete_step` вне активной задачи больше не роняет цепочку в двухтактный ход — продолжение через `nextToolMove` (research-цепочка сохраняется). 4) Preview: `plan`/`report` добавлены в `VIEW_TYPES` — карточки с md (`microchat-view-plan`/`-report`, рамка + заголовок План/Отчёт); слова-маршруты (`plan`/`report` без `button`, `task` без `steps`) скрыты из ленты; кнопка «Принять» — через tip-панель (tipBlock уже видит последний блок с button). Стрим (`microchat-streaming`) рендерится markdown-viewer'ом вместо plain-текста. Прогон: 149 pass / 1 fail (та же чужая smoke-core регрессия).
- [01:30] Автомат маршрутов plan/task/do/report поверх двухтактного `prompt`. 1) `streamTurn` → `{ text, calls, usage }`: собирает `function_call`-чанки `streamChat` (arguments уже распарсены моделью), опции `{functions, function_call}` прокидываются в запрос. 2) Вход пользователя в новом `prompt`: `parseInput` + ветки — `confirm` по `pendingAction` (выполнить `executeToolCall` / отклонить), «Принять» блока `plan` → expect-ход `task`, «Принять» блока `report` → `task.state='completed'` без хода модели, generic-кнопки → prompt-факт + продолжение; `answers` → `applyAnswers` + `autoAdvanceClarifyStep` → следующий пункт. 3) expect-ходы (ASSISTENT, один проход, без классификации словом): `plan`/`report` — весь md-ответ → блок типа + кнопка «Принять» (wait); `task` — «Сделай to do список…» → `parsePlanBodySteps` → блок `task` (active, steps, свой ribbon) + инъекция первого пункта; `step`/`do`/`research` — FC-ход (`buildFunctionsList` + `prepareFunctionsForStream`), research — только read-only набор `RESEARCH_METHODS`. 4) Исполнение вызова (`executeOneCall`): `ask_user` → блок `questions` (wait); `complete_step` → движок шагов (`completeTaskStep`, ворота), все done → expect `report`; **любой файл-модифицирующий метод** (`isFileWriteMethod` ∪ `DANGEROUS_METHODS`) → `pendingAction` + action «Действие/Выполнить», без trust-автопропуска; read-only → сразу → `tool`+`tool_result` → продолжение (`nextToolMove`: в задаче — возврат к пункту, research — следующий поиск, иначе двухтактный ход). 5) Слово `task` в маршрутах (ROUTE_TYPES), `TASK_TODO_PROMPT`/`REPORT_AFTER_STEPS`; `findOpenInteractive` видит `plan`/`report` с кнопкой; `buildHistoryFromRibbon` — md-результаты целиком + факт «кнопка ожидает», слова — `[маршрут: тип]`; лимит `MAX_AUTO_TURNS` → action «Продолжить». Прогон: tests/*.test.js — 149 pass / 1 fail (smoke-core, чужая регрессия в `sources/server/file.js`, воспроизводится без этих правок).

## В работе

- Обкатка полного цикла на живых прогонах: plan → Принять → task → шаги (FC + кнопки на save_file) → report → Принять.
- Перенос остатков из `prompt_old`: subplan-декомпозиция, teach-ворота прозы, spawn_agent, usage-учёт, stop/abort.

## Ключевые решения

- **expect-ход = формат результата.** Самовызов несёт `params.expect`; ответ модели целиком становится блоком этого типа — без второго такта классификации. Слово-маршрут решает «что дальше», expect-ход делает «как именно».
- **Любые изменения файлов — только через кнопку.** `pendingAction` + «Выполнить» на каждый файл-модифицирующий вызов; trust-автопропуск в новом цикле не применяется.
- **Кнопки «Принять» на блоках plan/report.** Блок-результат сам является интерактивом (`findOpenInteractive`); confirm плана запускает task, confirm отчёта закрывает задачу.
- **Роль — дискриминатор промпта.** Реальный (USER/BOSS/ADMIN) → лента; ASSISTENT — только остриё.

## Блокеры / Открытые вопросы

- Модели без functionCalling: FC-ходы падают в текст (wait) — нужен текстовый fallback вызовов (парсер prompt_old) при обкатке на GigaChat Light.
