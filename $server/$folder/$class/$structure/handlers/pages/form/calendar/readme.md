# Calendar — форма календаря класса

## 1. Что это

Page-handler календаря класса: сетка встреч (день / рабочая неделя / неделя / месяц) и список справа. Встреча — JSON в `.ics` + запись лога с `ext: 'ics'`.

## 2. Зачем это нужно

Один экран расписания организации: события из логов класса за видимый диапазон, без отдельного хранилища и без параллельных шаблонов дня и недели.

## 3. Как это работает

- `viewMode`: `day` | `workweek` | `month` | `week`. Диапазон — геттеры `day` / `dayFrom` / `dayTo` от `currentDate` (ISO-неделя с понедельника). `workweek` — пн–пт той же недели.
- `oda-date-nav` показывает период по `viewMode`: день `dd.mm.yyyy`, неделя/рабочая неделя — диапазон (`04 - 10.08.2026` / `28.07 - 03.08.2026`), месяц — `Month yyyy`. Дата выбирается нативным календарём, не с клавиатуры; `currentDate` — выбранный день.
- `events` — `logs({ mode: 'bodies', from, to, ext: 'ics' })`. Фильтр `selected_users` по `sender`. Живое обновление — `listen('changed')` на папке `history`. Поле `allDay` из JSON тела прокидывается в событие.
- Time-режимы — `oda-calendar-time-grid`: 1 / 5 / 7 колонок, слот 30 минут, позиция timed-события — доля суток; шапка закреплена сверху, колонка часов — слева. Шапка колонки: строка 1 — число месяца слева, день недели на остатке ширины (`class="flex"`); строка 2 — полоса all-day (клик создаёт встречу на весь день, чипы — сохранённые `allDay` этого дня; мультидневные — чип в каждом пересечённом дне). All-day в timed-сетку не попадают.
- Месяц — `oda-calendar-month-view`: дни = `dayFrom..dayTo`, сетка 8 колонок; слева вертикальная подпись диапазона недели (первая–последняя ячейка строки; месяц один раз, если совпадает).
- Создание и правка — `showMeeting` → `calendar-form` (чекбокс All day) → `save_file` с `message` `{ start, end, summary, location, allDay }` и `time` = начало встречи. All-day: `start` 00:00 дня, `end` 00:00 следующего.

## 4. Из чего это состоит

- [`$handler/class.js`](/$server/$folder/$class/$structure/handlers/pages/form/calendar/$handler/class.js/~/handlers/pages/form/) — handler, сетки, чип `oda-calendar-event`, список, `oda-date-nav`
- Форма: [`calendar-form.js`](/$server/$folder/lib/calendar-form/calendar-form.js/~/handlers/pages/form/) — `calendar-form`; файл `.ics`: [`$ics/.../form/file`](/$server/$folder/$file/$ics/handlers/pages/form/file/$handler/class.js/~/handlers/pages/form/) — `oda-calendar-event-form`

## 5. В каком это состоянии

- ✅ day / workweek / week / month, список, фильтр пользователей
- ✅ загрузка через `logs({ mode: 'bodies' })`
- ✅ кнопка «сегодня» (метод `goToday`)
- ✅ двухстрочная шапка time-grid, полоса all-day (создание и показ)
- ❌ spanning встречи через колонки / полосы месяца

## 6. Дальнейшие планы

- Настоящий RFC 5545 как тело `.ics`
