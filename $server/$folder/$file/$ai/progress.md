# Прогресс: $ai / task.ai

## Последние изменения

- [22.07.2026] Function calling + Cursor AskQuestion: GigaChat Light/Pro `functionCalling: true`; idle clarify → select+options (не text «Что уточнить?»); `MAX_IDLE_PROPOSE=1`; preview radio options.
- [22.07.2026] MVP harness: контекст пары user/class (readme, .mem, логи) + ACL USER/BOSS/ADMIN + confirm для ADMIN system-modify — агент видит факты операций и не пишет мимо роли; вход через `triggers/on_save`, не file-handlers.
- [22.07.2026] Документация `$ai` по `rules.md` (readme 6 разделов, progress + history-снимок).

## В работе

- Ручной прогон в UI: «сделай презентацию» → Начать → кликабельные options (не text).
- Хвост menu/node/folder.js вне этого коммита.

## Ключевые решения

- **FC на GigaChat обязателен для Cursor-пути.** Причина: без `functionCalling` streamChat не шлёт `functions` → native `ask_user` невозможен.
- **Idle inject = AskQuestion shape, не text.** Причина: Light всё ещё может idle; text «Что уточнить?» убивает UX.
- **`MAX_IDLE_PROPOSE = 1`.** Причина: не ждать второй пустой ход — сразу показать options.
- **Контекст = пара user/class, не только readme класса.** Причина: readme — декларация, логи — факт (whitepaper).
- **Не воскрешать file-handlers / skill-router.** Причина: канон — `triggers/on_save` → prompt harness.

## Блокеры / Открытые вопросы

- Нужен ли живой e2e в UI до следующего шага (spawn_agent / skills-as-tools)?
