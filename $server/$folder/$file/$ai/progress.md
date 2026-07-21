# Прогресс: $ai / task.ai

## Сейчас

MVP runtime harness: контекст пары user/class, ACL ролей, ADMIN modify-path с confirm. Вход — `triggers/on_save`.

## Последние изменения

### 2026-07-22 — MVP шаги 1–3

- Контекст: `loadContextBundle` (readme, .mem, сжатые логи) для class и user → system.
- ACL: `formatRoleAclForSystem`, `roleBlocksTool`, confirm для ADMIN system-modify.
- Тесты: `context-bundle`, `role-acl`, `mvp-e2e-roles`.
- Документация: этот readme/progress; host file-handlers не восстанавливаем.

## Открыто

- Ручной прогон в UI под USER и ADMIN в живом классе
- Коммит накопившихся preview/on_save правок (отдельный шаг при необходимости)
