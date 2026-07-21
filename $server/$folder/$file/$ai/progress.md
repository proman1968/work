# Прогресс: $ai / task.ai

## Последние изменения

- [22.07.2026] MVP harness: контекст пары user/class (readme, .mem, логи) + ACL USER/BOSS/ADMIN + confirm для ADMIN system-modify — агент видит факты операций и не пишет мимо роли; вход через `triggers/on_save`, не file-handlers.
- [22.07.2026] Документация `$ai` по `rules.md` (readme 6 разделов, progress + history-снимок).

## В работе

- Ручной прогон в UI под USER и ADMIN.
- Закоммитить накопившиеся правки preview/on_save и связанные тесты (хвост сессии).

## Ключевые решения

- **Контекст = пара user/class, не только readme класса.** Причина: readme — декларация, логи — факт (whitepaper); без логов агент «знает инструкцию», но не «что происходит».
- **Роль в system + gate в harness.** Причина: ACL на сервере недостаточен для поведения модели; USER/BOSS не должны предлагать правку типизаторов.
- **ADMIN modify только plan → confirm.** Причина: whitepaper §10 — самомодификация с человеческим контролем.
- **Не воскрешать file-handlers / skill-router.** Причина: временный костыль; канон — `triggers/on_save` → prompt harness.

## Блокеры / Открытые вопросы

- Нужен ли живой e2e в UI до следующего шага (spawn_agent / skills-as-tools)?
