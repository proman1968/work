# Calendar — форма календаря класса

## 1. Что это

Page-handler календаря класса: сетка встреч (день / рабочая неделя / неделя / месяц) и список справа. Встреча — JSON в `.ics` + запись лога с `ext: 'ics'`.

## 2. Зачем это нужно

Один экран расписания организации: события из логов класса за видимый диапазон, без отдельного хранилища и без параллельных шаблонов дня и недели.

## 3. Как это работает

- `viewMode`: `day` | `workweek` | `month` | `week`. Диапазон — геттеры `day` / `dayFrom` / `dayTo` от `currentDate` (ISO-неделя с понедельника). `workweek` — пн–пт той же недели.
- `events` — `logs({ mode: 'bodies', from, to, ext: 'ics' })`. Фильтр `selected_users` по `sender`. Живое обновление — `listen('changed')` на папке `history`.
- Time-режимы — `oda-calendar-time-grid`: 1 / 5 / 7 колонок, слот 30 минут, позиция события — доля суток. Месяц — `oda-calendar-month-view`, дни = `dayFrom..dayTo`.
- Создание и правка — `showMeeting` → `oda-calendar-event-form` → `save_file` с `message` `{ start, end, summary, location }` и `time` = начало встречи.

## 4. Из чего это состоит

- [`$handler/class.js`](/$server/$folder/$class/$structure/handlers/pages/form/calendar/$handler/class.js/~/handlers/pages/form/) — handler, сетки, чип `oda-calendar-event`, список, `oda-date-nav`
- Форма файла: [`$ics/.../form/file`](/$server/$folder/$file/$ics/handlers/pages/form/file/$handler/class.js/~/handlers/pages/form/) — `oda-calendar-event-form`

## 5. В каком это состоянии

- ✅ day / workweek / week / month, список, фильтр пользователей
- ✅ загрузка через `logs({ mode: 'bodies' })`
- ❌ кнопка «сегодня» (метод `goToday` есть)
- ❌ spanning встречи через колонки / полосы месяца

## 6. Дальнейшие планы

- Кнопка «сегодня» у picker
- Настоящий RFC 5545 как тело `.ics`
