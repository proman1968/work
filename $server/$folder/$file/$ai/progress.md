# Прогресс: $ai / task.ai

## Последние изменения

- [13:40] **PIPE → `pipe.json` + флаг `mutates`.** Дерево пайплайна вынесено из `class.js` в чистый JSON (`pipe.json`, рядом с `class.js`) — грузится лениво через `_pipe()` и кэшируется на инстансе. Промпты инлайнятся в узлы (отдельных `*_PROMPT` констант нет). Костыли `WRITE_METHODS`/`WORK_READ_METHODS` удалены: подтверждение изменений теперь по флагу `mutates` (JSDoc-тег `@mutates` владельца метода → `buildAiSchema` пробрасывает в схему; harness `save_file`/`edit` несут `mutates` в `HARNESS_FUNCTIONS`). `fc`-узел поддерживает сентинель `'readonly'` (только `!mutates`) для ветки поиска в рабочей области. `@mutates` проставлено: `save_file`/`save_files` (`$folder`), `create` (`$class`), `edit` (`$file`).
- [12:12] **PIPE-канон пайплайна.** Замена плоских `ROUTES`/`RESEARCH_ROUTES` + кучи `_<route>` хендлеров одним деревом `PIPE` (конечный автомат) и одним движком `_walk`. Узел = состояние: `prompt`/`inject`/`next`/`button`/`fc`/`askType`; корень — `thinking`. Маршрутизация: 1 ребёнок → напрямую, N → меню из `inject`. Wait-узлы (`button`) стопят до клиента. Лист: `fc` → `_handle_call` + continue на `thinking`; без `fc` (`step`) → отрендеренный `prompt` как continue-строка. Ворот `allDone` в `thinking` → форс `report`. Разбор кнопок `_confirm` свёрнут в `prompt` → `_resolve_button` (pendingAction, answers, «Принять» plan → `task`, «Принять» report → `completed`). Удалено 14 методов (`_thinking`/`_research`/`_plan`/`_report`/`_task`/`_action`/`_cancel`/`_web`/`_work`/`_question`/`_form`/`_ask_user`/`_fc_move`/`_confirm`) + `_plan_ready_for_task`; убраны константы `ROUTES`/`RESEARCH_ROUTES`/`ACTION_PROMPT`/`RESEARCH_PROMPT`.
- [09:55] Служебные методы файла `stop` и `change_model`. 1) `stop` — `requestAbort` + `chat.done stopped`; task/pendingAction не трогает. 2) `change_model` — пишет `body.model` через fsp (без on_save). 3) Abort подключён к автомату: `clearAbort` на реальном ходе, проверка в `streamChat` / `_walk` / `_handle_call`. 4) Preview: `fetch('stop')`, `fetch('change_model')` вместо `prompt {stop}` и полного `save`.

## В работе

- Обкатка полного цикла на живых прогонах по `PIPE`: thinking → plan → Принять → task → step → action/research → complete_step → … → report → Принять; Stop mid-flight; смена модели.
- Доработка `PIPE`: subplan-декомпозиция в ходе, teach-ворота прозы, spawn_agent, usage-учёт; текстовый fallback FC для моделей без functionCalling.

## Ключевые решения

- **PIPE — конечный автомат**, не плоский список маршрутов: дерево узлов-состояний + один движок `_walk`. Меньше методов, декларативность.
- **`_walk` один за всё**: генерация/инъекция, FC-проход, маршрутизация (1/N детей), wait-узлы, continue-листья. `_<route>` хендлеры упразднены.
- **Разбор кнопок — в `prompt`** (`_resolve_button`), не отдельный `_confirm`: pendingAction, answers, «Принять» plan/report.
- **stop / change_model — методы файла**, рядом с `prompt` (общий abort Map с автоматом), не `$method`-папки и не контрабанда через prompt.
- **Stop не отменяет задачу** — только текущую генерацию/самовызовы.
- **change_model не абортит** — новая модель со следующего `resolveChatModel`.

## Блокеры / Открытые вопросы

- Модели без functionCalling: FC-ходы падают в текст (wait) — нужен текстовый fallback вызовов.
