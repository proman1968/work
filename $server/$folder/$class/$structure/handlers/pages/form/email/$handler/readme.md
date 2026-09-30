# Email — форма почты класса

## 1. Что это

Page-handler почты класса: три колонки (входящие / исходящие / корзина) и просмотр, написание или ответ на письмо. Письмо — JSON в `.eml` + запись лога с `ext: 'eml'`.

## 2. Зачем это нужно

Один экран переписки организации: список из логов класса, отправка через `save_file` → `outbound.eml` → SMTP-триггер, приём — метод `refresh` (IMAP). Секреты ящиков — `email.json`.

## 3. Как это работает

- Колонки — `boxes`: `inbox` | `outbox` | `trash`. Письмо попадает в колонку по полю `box`.
- Дни — `logs({ mode: 'dates' })`, одна загрузка на форму. Письма дня — `logs({ mode: 'bodies', day, ext: 'eml' })` при раскрытии дня, кэш общий для трёх колонок.
- Метаданные списка — `message` лога `{ uid, subject, from, to, date, box, mailbox, status, messageId }`. Старые записи без `box` в `message` читаются из файла (legacy).
- Тело — лениво при открытии (`fetch(row.path)`). HTML показывается в `<iframe sandbox>` без скриптов.
- Написать — поле «От» (список ящиков, по умолчанию первый), проверка «Кому», `outbound.eml` в `folder: <address>` с `uid`. Триггер `$eml` / `on_save` отправляет и сохраняет новую версию со `status: sent | failed` (+ `error`); в «Исходящих» — последняя версия по `uid`.
- Ответить — `Re: тема`, «Кому» = отправитель, «От» = ящик письма, цитата тела, `inReplyTo` = `messageId`.
- Живое обновление — `listen('changed')` на `$item` и папке логов, отписка в `detached`.
- Обновить — `$handler.fetch('refresh')`. Настройки — `showSettings` (общий тулбар handler), `read_secret` / `save_secret` (`email.json`).

## 4. Из чего это состоит

- [`$handler/email.js`](/$server/$folder/$class/$structure/handlers/pages/form/email/$handler/email.js/~/handlers/pages/form/) — форма, колонки, день, просмотр/compose/ответ, диалог ящиков
- [`$handler/class.js`](/$server/$folder/$class/$structure/handlers/pages/form/email/$handler/class.js/~/handlers/pages/form/) — `showSettings`
- [`refresh`](/$server/$folder/$class/$structure/handlers/pages/form/email/$handler/methods/refresh/$method/class.js/~/handlers/pages/form/) — IMAP-синхронизация в `.eml` + лог
- [`on_save (.eml)`](/$server/$folder/$file/$data/$eml/triggers/on_save/$trigger/class.js/~/handlers/pages/form/) — SMTP для `outbound.eml`

## 5. В каком это состоянии

- ✅ три колонки, загрузка через `logs`, изолированный HTML
- ✅ compose с выбором ящика, ответ, статусы `pending` / `sent` / `failed`
- ✅ настройки ящиков в `#secret/email.json`
- ❌ вложения, IMAP-папки кроме inbox/outbox/trash

## 6. Дальнейшие планы

- Вложения, пересылка, пометка прочитанных
