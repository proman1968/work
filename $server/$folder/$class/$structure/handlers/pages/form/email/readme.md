# Email — форма почты класса

## 1. Что это

Page-handler почты класса: три колонки (входящие / исходящие / корзина) и просмотр или написание письма. Письмо — файл `.eml` + запись лога с `ext: 'eml'`.

## 2. Зачем это нужно

Один экран переписки организации: список из логов класса, отправка через `save_file` → `outbound.eml` → SMTP-триггер, приём — метод `refresh` (IMAP). Секреты ящиков — `email.json`.

## 3. Как это работает

- Колонки — `boxes`: `inbox` | `outbox` | `trash`. Строка списка — лог с `ext: 'eml'`, отфильтрованный по пути `/message/.<address>/(inbox|outbox|trash).eml`.
- Дни — `logs({ mode: 'dates' })`. Письма дня — `logs({ mode: 'bodies', day, ext: 'eml' })` при раскрытии дня. Живое обновление — `listen('changed')` на папке `history`.
- Метаданные списка — `content` лога `{ subject, from, to, date }`. Тело — лениво: `WORK.get_item(row.path)` + `load()`, разбор RFC822 только в режиме просмотра.
- Написать — `outbound.eml` в `folder: <address>` (первый ящик из настроек) с тем же `message`, что у IMAP. Триггер `$eml` / `on_save` отправляет SMTP, если базовое имя файла `outbound.eml`.
- Обновить — `$handler.fetch('refresh')`. Настройки — `read_secret` / `save_secret` (`email.json`), диалог `oda-email-settings`.

## 4. Из чего это состоит

- [`$handler/class.js`](/$server/$folder/$class/$structure/handlers/pages/form/email/$handler/class.js/~/handlers/pages/form/) — оболочка (`item-email`), форма, колонки, день, просмотр/compose, диалог ящиков
- [`refresh`](/$server/$folder/$class/$structure/handlers/pages/form/email/$handler/methods/refresh/$method/class.js/~/handlers/pages/form/) — IMAP-синхронизация в `.eml` + лог
- [`on_save (.eml)`](/$server/$folder/$file/$eml/triggers/on_save/$trigger/class.js/~/handlers/pages/form/) — SMTP для `outbound.eml`

## 5. В каком это состоянии

- ✅ три колонки, дни из `logs({ mode: 'dates' })`, письма дня из `logs({ mode: 'bodies', ext: 'eml' })`
- ✅ compose → `outbound.eml` с `message` в логе; SMTP-триггер на `outbound.eml`
- ✅ настройки ящиков в `#secret/email.json`
- ❌ выбор ящика (берётся первый), multipart/HTML, вложения
- ❌ IMAP-папки кроме inbox/outbox/trash в колонках не показываются

## 6. Дальнейшие планы

- Канон ящиков и маппинг IMAP-папок на inbox / outbox / trash
