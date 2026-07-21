# Прогресс: $ai / task.ai

## Последние изменения

- [22.07.2026] UI: nested AskQuestion был с высотой 0 (`microchat-ribbon` flex:1 внутри task) — `embedded` + авто-раскрытие task; options снова видны под «1/4».
- [22.07.2026] Do после «Уточнить»: `write_file`/`read_file` в списке FC (раньше не было в get_schema); clarify-шаг → done + next; пустые answers не гонят LLM; nested history без дубля system.
- [22.07.2026] Function calling + Cursor AskQuestion: GigaChat Light/Pro `functionCalling: true`; idle clarify → select+options (не text «Что уточнить?»); `MAX_IDLE_PROPOSE=1`; preview radio options.
- [22.07.2026] MVP harness: контекст пары user/class (readme, .mem, логи) + ACL USER/BOSS/ADMIN + confirm для ADMIN system-modify — агент видит факты операций и не пишет мимо роли; вход через `triggers/on_save`, не file-handlers.
- [22.07.2026] Документация `$ai` по `rules.md` (readme 6 разделов, progress + history-снимок).

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
