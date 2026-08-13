# Прогресс: $task

## Последние изменения
- [17:55] Синхронизированы `readme` `$task` и preview с кодом — убраны устаревшие `pipe.js` / `build`-only / `_active_pipe`, зафиксированы PIPE в `class.js`, form parse/approve, stickBottom, APPROVE+values.

## В работе
- Сведение узлов PIPE к единому контракту `plan`/`do` + wait (`allow_approve` / `approve`)
- FC и tool-диспетчер ещё не в `prompt()`

## Ключевые решения
- `PIPE` живёт в `class.js`, не в отдельном модуле — один файл = харнесс + реестр.
- Wait-канал один: `role:'APPROVE'` + `pipe_step.approve`; form передаёт JSON answers в `prompt`, planning — `true`/`false`/текст.
- Follow ленты только при `stickBottom` (не force на каждый reload).

## Блокеры / Открытые вопросы
- Узлы с плоским `next` (`research`/`web`/`work`) не попадают в меню thought, пока нет `plan`/`do`
- `complete.approve` и auto-add в меню контейнеров отсутствуют
