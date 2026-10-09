# ai/skills — навыки

Навык — проверенный рецепт повторяемой работы. Список навыков (`name: description`) входит в system агента (и субагента); подходящий агент загружает навык инструментом `skill` и следует ему.

Файл `имя.md`:

```md
---
name: register-accounts
description: Когда применять — одной фразой
requires: system          # необязательно: system | sandbox — виден, только если это доступно
---
# Шаги
1. … какие инструменты, пути, контракты мест
2. … проверки результата, подводные камни
```

Слои: навыки пакета движка — для всей системы; `ai/skills/` в метапапке класса — для этого класса и ниже (ближний перекрывает по имени). Навык, привязанный к конкретному месту (его пути и контракты), лежит в метапапке этого места, а не здесь: например `/DATA/REGISTER/$register/ai/skills/register-accounts.md`.

Запись: инструмент `save_skill` (`name`, `description`, `content`, `scope`: `place` — метапапка места задачи, `global` — пакет движка, с подтверждением). Агент предлагает сохранить удачную повторяемую работу (как писать — навык `skill-authoring`); человек может попросить «зафиксируй как навык».

Рецепт опирается на реальные инструменты ядра и их параметры; `tests/ai-package.test.js` проверяет, что названные в нём инструменты существуют.

| Навык | Назначение |
|---|---|
| [`office-documents`](office-documents.md) | PDF/DOCX/XLSX: чтение, шаблоны, отчёты, настоящий PDF из HTML |
| [`doc-from-template`](doc-from-template.md) | документ по шаблону docx/md/html из объекта или данных |
| [`import-table`](import-table.md) | таблица Excel/CSV → объекты данных с проверкой |
| [`data-quality`](data-quality.md) | дубли, пустые поля, форматы — отчёт с исправлениями |
| [`summarize-feed`](summarize-feed.md) | сводка «что произошло» в точке за период |
| [`delegate-task`](delegate-task.md) | поручение через ленту с получателем, сроком и контролем |
| [`approval-flow`](approval-flow.md) | согласование документа по цепочке через ленту |
| [`meeting-minutes`](meeting-minutes.md) | протокол встречи, решения и поручения участникам |
| [`email-mailbox`](email-mailbox.md) | разбор почтового ящика точки, черновики ответов |
| [`org-structure`](org-structure.md) | развернуть оргструктуру: подразделения, роли, контракты |
| [`onboarding`](onboarding.md) | вывести сотрудника на работу: роли, приветственное поручение |
| [`request-access`](request-access.md) | не хватает прав: выяснить причину и запросить доступ у ответственного |
| [`scheduled-report`](scheduled-report.md) | повторяющаяся или отложенная работа агента по расписанию |
| [`ai-trigger`](ai-trigger.md) | агент на событие: сохранён файл в точке → инструкция (ADMIN) |
| [`restore-file`](restore-file.md) | откат файла к прежней версии из истории |
| [`skill-authoring`](skill-authoring.md) | как сохранить удачную работу навыком |
| [`google-calendar`](google-calendar.md) | события Google Календаря пользователя |
| [`telegram-notify`](telegram-notify.md) | уведомление через бота организации |
| [`external-signup`](external-signup.md) | показать сайт человеку, регистрация и подключение внешнего API по токену |
| [`printer-setup`](printer-setup.md) | печать и подключение сетевого принтера |
| [`scan-to-work`](scan-to-work.md) | скан документа сразу в зону роли точки |
| [`computer`](computer.md) | персональный компьютер пользователя: команды, экран, браузер (нужен Docker) |
| [`lan-inventory`](lan-inventory.md) | инвентаризация локальной сети и регистрация устройств (ADMIN) |
| [`node-connect`](node-connect.md) | подключение сервера-партнёра сети WORK (ADMIN) |
| [`backup-check`](backup-check.md) | проверка резервных копий и места на дисках (ADMIN) |

Навыки мест: [`register-accounts`](/DATA/REGISTER/$register/ai/skills/register-accounts.md) — типовые счета в журнале `/DATA/REGISTER`.
