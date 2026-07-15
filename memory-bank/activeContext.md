# Текущий контекст работы

## Задача: Рефакторинг системы безопасности (admin/master/slaves)

### Модель безопасности (утверждена пользователем)

Три роли: **admin**, **master**, **slaves**. Назначаются через `#security` в `class.js`:
```js
'#security': { admin: "UID", master: "UID", slaves: ["UID"] }
```

| Роль | Видит (чтение) | Пишет (запись) | Наследование ролей |
|------|---------------|----------------|-------------------|
| admin | Всё от точки вниз | SYSTEM (всё, КРОМЕ `$work`) | Вниз на всю глубину |
| master | Всё от точки вниз | MANAGEMENT (distributed `$work`) | Вниз на всю глубину |
| slave | Только класс назначения | WORK (meta `$work`) | НЕ наследуется |

### Зоны записи
- **SYSTEM** — метапапка (всё, кроме `$work`) → admin
- **MANAGEMENT** — distributed `$work` → master (только класс назначения)
- **WORK** — meta `$work` → slave (только класс назначения)

### Запись требует `params.role` — клиент передаёт выбранную роль.

## Завершённые этапы

### Этап 1: Ядро безопасности в `$class` ✅
- `sources/server/class.js` — константы ROLES/ZONES/ACCESS_LEVEL, методы roles/canSee/canWrite/allowAccess/resolveZone
- Геттеры masters/slaves исправлены (masters наследуется, slaves — нет)
- Метод `roles()` переписан через геттеры

### Этап 2: Делегирование в `$folder` + `$file` ✅
- Убран импорт `security.js` из `folder.js` и `file.js`
- Добавлен `allowAccess()` в `$folder` — делегирует к `$owner`
- Все вызовы `Security.allowAccess` заменены на `this.allowAccess`

## Этап: Ролевая модель чата ✅

### Изменения:
- **`sources/server/class.js`**: `get_storage({role})` — admin → `$folder/$work`, `chatSource(params)` — возвращает путь к источнику логов по роли
- **`$server/.../chat/$handler/class.js`**: `chat-day.logsSource` — запрашивает `chatSource` у сервера
- **`sources/client/folder.js`**: свойство `role` (get/set через localStorage), `fetch()` автоподстановка `params.role`, цветовая индикация (`--main-color`: admin=red, master=green, slave=indigo)

### Модель:
| Роль | Чат видит | Файлы пишутся в | Логируется в |
|------|----------|----------------|-------------|
| slave | Логи `$user` | `meta/$work/` | Класс + `$user` |
| master | Логи класса | `distributed/$work/` | Класс + `$user` |
| admin | Логи `$user` | `$folder/$work/` | Класс + `$user` |

## Все этапы завершены ✅

- **Этап 3 ✅:** HTTP-слой — убраны импорты `security.js`, `ensureBootstrapAdmin` → метод `$class`
- **Этап 4 ✅:** Клиент — `isAdmin` переписан через `roles()` (fetch), добавлен геттер `roles`
- **Этап 5 ✅:** `sources/host/security.js` удалён
- **Этап 6 ✅:** Легаси-методы убраны из `$class`

## Технический долг

- `tests/security.test.js`, `tests/auth-sessions.test.js`, `tests/class/access.test.js` — импортируют удалённый `security.js`, не работают. Нужен перенос тестов под новую объектную модель безопасности.
