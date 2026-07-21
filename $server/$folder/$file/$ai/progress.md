# Прогресс: $ai / task.ai

## Последние изменения

- [01:09] UI: откат костылей (`_taskItem` / native ask / openAsk) — ломали план; оставлены `item: null`, `collapsed: false`, nested `embedded` + get/set `questions` у form.
- [00:53] Do: `write_file` в FC; clarify→done; GigaChat `functionCalling` + AskQuestion select inject.
- [00:25] MVP harness: контекст пары user/class + ACL USER/BOSS/ADMIN + confirm ADMIN modify; вход через `triggers/on_save`.
- [00:25] Документация `$ai` по `rules.md`.

## В работе

- Ручной прогон: options → Уточнить → (Подтвердить write) → файл презентации.
- Хвост menu/node/folder.js вне этого коммита.

## Ключевые решения

- **write_file должен быть в functions, не только в executeToolCall.** Причина: get_schema/TOOL_DESCRIPTIONS его не отдают — модель с FC физически не могла писать файл после clarify.
- **FC на GigaChat обязателен для Cursor-пути.** Причина: без `functionCalling` streamChat не шлёт `functions` → native `ask_user` невозможен.
- **Idle inject = AskQuestion shape, не text.** Причина: Light всё ещё может idle; text «Что уточнить?» убивает UX.
- **`MAX_IDLE_PROPOSE = 1`.** Причина: не ждать второй пустой ход — сразу показать options.
- **Контекст = пара user/class, не только readme класса.** Причина: readme — декларация, логи — факт (whitepaper).
- **Не воскрешать file-handlers / skill-router.** Причина: канон — `triggers/on_save` → prompt harness.

## Блокеры / Открытые вопросы

- Нужен ли живой e2e в UI до следующего шага (spawn_agent / skills-as-tools)?
