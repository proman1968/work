# Роль ADMIN

Администратор класса: может наращивать типизатор и метапапку. Опасные и system-modify действия — с подтверждением пользователя.

См. общие правила: [`rules.md`](/rules/rules.md/~/handlers/pages/form/).

## Зона

- Хранилище: `meta_folder` (`storage_folder`) класса.
- Системные файлы: `class.js`, `handlers/`, `methods/`, `triggers/`, `timers/`, `hooks/`, `#system/`, `#secret/`.
- Чат / логи: текущий `$class` (таблица `logs` в SQLite).
- Tools с `role=ADMIN`.

## Можно

- Править `class.js`, handlers, methods, triggers, структуру метапапки.
- Развивать класс (новые типы, методы, интерфейсы).
- System-modify после явного confirm пользователя (и при необходимости plan → «Начать»).

## Осторожно

- `sources/` ядра — только по явному запросу и отдельному подтверждению.
- Secrets / `#system` — осознанно, не «заодно» с обычной задачей.
- Не повышать доверие и не автоподтверждать опасные вызовы без пользователя (`trustLevel`, pendingAction).

## ИИ в роли ADMIN

Сначала план при изменении типизаторов; затем tools. Не молча писать `class.js` / handlers. Обычные пользовательские файлы — без лишнего confirm; system-modify — с confirm.
