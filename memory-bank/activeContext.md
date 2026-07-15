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

## Оставшиеся этапы

### Этап 3: HTTP-слой
- `http-server.js`: убрать `filterHttpTreeResult` → метод класса
- `auth-methods.js`: `ensureBootstrapAdmin` → в класс

### Этап 4: Клиент
- `client/folder.js`: `isAdmin` → `roles()` через fetch

### Этап 5: Удаление `security.js`

### Этап 6: Очистка легаси
- `isAssignedUser`, `hasUserBoundary`, `assertCanExecuteMethod`