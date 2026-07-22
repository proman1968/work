# Прогресс: $ai / task.ai

## Последние изменения

- [12:10] Preview переписан декларативно: `body` + `~is`/`~props` по TYPES; task = nested ribbon; Ask = `microchat-view-questions` + `microchat-field`; убраны normalize/sync/openAsk.
- [11:00] Fix AskQuestion UI (native options) — промежуточный костыль; заменён declarative rewrite.
- [10:55] MVP e2e harness: write без confirm, file-блок, FC tool_calls, plan≥4, MAX_IDLE_DO=3.
- [00:25] MVP harness ACL + on_save; документация `$ai`.

## В работе

- Живой UI-прогон: план → Начать → options в task → Уточнить → write → file.
- Следующий шаг: `spawn_agent` / skills-as-tools.

## Ключевые решения

- **Preview = bind task.ai, не FSM.** `~props` блока = props view; один `body`; Reactor рисует.
- **task не особый случай.** Nested `microchat-ribbon :items="ribbon"` — тот же диспетч; Ask внутри как `microchat-view-questions`.
- **Ask пишет в `field.value` на объекте из body** (`:field="$for.item"`), не копия через get/set form.
- **migrateRibbon только на load.** Не normalize на каждый render.
- **Обычный write_file без trust-confirm** (harness). Confirm — system-modify.
- **Не воскрешать file-handlers / skill-router.**

## Блокеры / Открытые вопросы

- (нет)
