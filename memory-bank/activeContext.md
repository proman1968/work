# Текущий контекст работы

## Завершено: Рефакторинг системы безопасности + ролевая модель чата

### Система безопасности (admin/master/slaves) — полностью в объектной модели

Три роли, назначаются через `#security` в `class.js`:
```js
'#security': { admin: "UID", master: "UID", slaves: ["UID"] }
```

| Роль | Видит (чтение) | Пишет (запись) | Наследование |
|------|---------------|----------------|--------------|
| admin | Всё от точки вниз | `$folder/$work` + системные папки | Вниз |
| master | Всё от точки вниз | `distributed/$work` | Вниз |
| slave | Только класс назначения | `meta/$work` | НЕ наследуется |

**Файлы:**
- `sources/server/class.js` — ROLES/ZONES/ACCESS_LEVEL, roles(), canSee(), canWrite(), allowAccess(), resolveZone(), chatSource(), get_storage({role}), ensureBootstrapAdmin()
- `sources/server/folder.js` — allowAccess() делегирует к $owner
- `sources/server/file.js` — allowAccess() через $folder
- `sources/host/http-server.js` — без security.js
- `sources/host/auth-methods.js` — WORK.ensureBootstrapAdmin()
- `sources/client/folder.js` — role через $public/$save, fetch() подставляет params.role, цвет --main-color
- `sources/host/security.js` — УДАЛЕН

### Ролевая модель чата

| Роль | Чат видит | Файлы пишутся в |
|------|----------|----------------|
| slave | Логи `$user` | `meta/$work/` |
| master | Логи класса | `distributed/$work/` |
| admin | Логи `$user` | `$folder/$work/` |

**Файлы:**
- `sources/server/class.js` — chatSource(params) возвращает путь к источнику логов
- `$server/.../chat/$handler/class.js` — chat-day.logsSource запрашивает chatSource
- `$server/$folder/lib/node/node.js` — admin (щит), master (галстук), slaves (массив)
- `$server/$folder/lib/security/users/users.js` — свойство role, assignUser/suspendUser по роли
- `$server/$folder/lib/security/security.js` — getSecurity/saveSecurity

### Цветовая индикация
- admin → red
- master → green
- slave → indigo
- Устанавливается через `--main-color` в `set()` обработчике `role` в `$folder.$public`

## Текущая задача: Чистка кодовой базы

1. Поиск неиспользуемых импортов и мёртвого кода
2. Устаревшие ссылки на удалённый security.js
3. Легаси в клиентском folder.js (isAdmin через admins)
4. Удаление мёртвых файлов

## Технический долг
- tests/security.test.js, tests/auth-sessions.test.js, tests/class/access.test.js — импортируют удалённый security.js
- HTTP-фильтрация (canSee для info/get_item) — отключена, TODO в http-server.js