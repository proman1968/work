# ai/skills — навыки

Навык — проверенный рецепт повторяемой работы. Список навыков (`name: description`) входит в system агента; подходящий агент загружает инструментом `skill` и следует ему.

Файл `имя.md`:

```md
---
name: register-accounts
description: Когда применять — одной фразой
---
# Шаги
1. … какие инструменты, пути, контракты мест
2. … проверки результата, подводные камни
```

Слои: навыки пакета движка — для всей системы; `ai/skills/` в метапапке класса — для этого класса и ниже (ближний перекрывает по имени).

Запись: инструмент `save_skill` (`name`, `description`, `content`, `scope`: `place` — метапапка места задачи, `global` — пакет движка, с подтверждением). Агент предлагает сохранить удачную повторяемую работу; человек может попросить «зафиксируй как навык».

| Навык | Назначение |
|---|---|
| [`register-accounts`](register-accounts.md) | типовые счета отчётности в журнале `/DATA/REGISTER` |
| [`google-calendar`](google-calendar.md) | события Google Календаря пользователя |
| [`summarize-feed`](summarize-feed.md) | сводка «что произошло» в точке за период |
| [`delegate-task`](delegate-task.md) | поручение через ленту с получателем, сроком и контролем |
| [`meeting-minutes`](meeting-minutes.md) | протокол встречи, решения и поручения участникам |
| [`org-structure`](org-structure.md) | развернуть оргструктуру: подразделения, роли, контракты |
| [`onboarding`](onboarding.md) | вывести сотрудника на работу: роли, приветственное поручение |
| [`doc-from-template`](doc-from-template.md) | документ по шаблону docx/md/html из объекта или данных |
| [`import-table`](import-table.md) | таблица Excel/CSV → объекты данных с проверкой |
| [`data-quality`](data-quality.md) | дубли, пустые поля, форматы — отчёт с исправлениями |
| [`approval-flow`](approval-flow.md) | согласование документа по цепочке через ленту |
| [`lan-inventory`](lan-inventory.md) | инвентаризация локальной сети и регистрация устройств |
| [`node-connect`](node-connect.md) | подключение сервера-партнёра сети WORK |
| [`printer-setup`](printer-setup.md) | подключение сетевого принтера, печать документов |
| [`external-signup`](external-signup.md) | показать сайт человеку, регистрация и подключение внешнего API по токену |
| [`scan-to-work`](scan-to-work.md) | скан документа сразу в зону роли точки |
| [`backup-check`](backup-check.md) | проверка резервных копий и места на дисках (ADMIN) |
| [`email-mailbox`](email-mailbox.md) | разбор почтового ящика точки, черновики ответов |
| [`telegram-notify`](telegram-notify.md) | уведомление через бота организации |
