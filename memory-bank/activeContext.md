# Текущий контекст работы

## Сессия 16.07.2026 — завершена

### Основные изменения:

#### 1. Переименование `$work` → `work`
- `sources/server/class.js`: `get_storage()` и `resolveZone()` — `'$work'` → `'work'`
- Физические папки переименованы на диске
- Причина: `$work` конфликтовал с `tilde`-маршрутизацией (short-path заменял `$` на `~`, создавая двойные `~`)

#### 2. Логи `data.logs` — перехват в `$class.save_file`
- `data.logs` всегда пишется в `meta_folder/logs/`, минуя `get_storage`
- Не зависит от `role` — системная операция

#### 3. `slave` — базовая роль для всех
- `roles()` в `class.js` — всегда добавляет `'slave'` для залогиненного пользователя

#### 4. Селектор ролей в форме
- `$server/$folder/handlers/pages/form/$handler/class.js` — динамическое переключение представлений (без `location.assign`)
- Активное представление перемещается в начало списка
- Смена роли → `$item.reset()` (без перезагрузки страницы)

#### 5. Панель управления микрочата
- `$server/$folder/$file/$ai/handlers/preview/$handler/class.js`:
  - Убрана старая action-bar (6 кнопок) и кнопка Act
  - Новая панель: одна главная кнопка + (X) для отмены (всегда видна)
  - Кнопка скролла перенесена с нижнего тулбара
  - Парсинг `<action>` из ответа ИИ → `actionButton`
  - `.thread` — убран `column-reverse`, нормальное направление текста
  - `chatGroups` — убран `.reverse()`

#### 6. SYSTEM_PROMPT обновлён
- Добавлена секция «Управление диалогом: тег `<action>`»
- ИИ обучен выдавать `<action>` при вопросах/планах
- Убраны обратные кавычки из template literal (вызывали `ReferenceError`)

#### 7. Function calling (код готов, не протестирован)
- `buildFunctionsFromSchema()` в `sources/modules/ai-schema.js`
- `prompt` метод передаёт `functions` в `streamChat`
- Fallback: текстовый парсинг `<tool_call>` сохранён

## Незавершённые задачи

### 1. Баг `oda-icon` — отложено
- Иконки залипают при переиспользовании компонента в `~for`
- Причина: `this.bb = undefined` создаёт own data property + мутация Proxy

### 2. Стандартизация имён методов/свойств
- Методы: `snake_case`
- Свойства: `camelCase`
- Приватные: `_` prefix

### 3. Полная проверка function calling в реальном микрочате

## Сессия 16.07.2026 (продолжение) — очистка SYSTEM_PROMPT и <action>

### Очистка SYSTEM_PROMPT от дублирования инструментов
- Удалено ~115 строк: «Инструменты и контекст», «Навигация», «function calling», «Доступные функции» (12 функций), «Работа с файлами», «Создание элементов системы»
- Заменено краткой секцией «Инструменты» (6 строк): get_schema, navigate/reset_context
- Причина: инструменты передаются через functions (function calling), дублирование в промпте нарушало decisionLog

### Упрощение тега <action>
- Было: accept_plan, accept_result, ok
- Стало: только однозначные вопросы да/нет
- onAction() упрощён: отправляет «Да», onCancelAction() — «Нет»

Изменённые файлы:
- on_save/$trigger/class.js — SYSTEM_PROMPT (327→212 строк)
- preview/$handler/class.js — onAction(), onCancelAction()