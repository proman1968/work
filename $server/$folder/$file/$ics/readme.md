# $ics — событие календаря

## Что это

Тип файла `.ics` у `$file` — **файл данных** (`METADATA`). Тело — JSON `{ start, end, summary, location, allDay, time, name }`, не RFC 5545.

## Зачем

Одна схема для сетки календаря и агента `work.typed`: поля на типе (`METADATA.FIELDS`), вход — `when.phrases`.

## Как

1. `when` + `METADATA.FIELDS` — в [`class.js`](class.js). Обязательные: `start`, `summary`. `end` пустой — +1 час от `start` (весь день — 00:00…00:00 следующего).
2. Запись — `save_file` на классе-месте: точка `work/ics/…/DAY/{time}.{uid}.ics`. Stem пути → `name`; корень `time` = начало встречи (день папки). Лог.path = этот файл. Календарь и `logs({ ext: 'ics' })` читают только это.
3. Форма сетки — [`calendar-form`](/$server/$folder/lib/calendar-form/calendar-form.js/~/handlers/pages/form/); preview парсит JSON.

## Состав

- [`class.js`](class.js) — `when`, `METADATA.FIELDS`
- `handlers/pages/form/file/` — `oda-calendar-event-form`
- `handlers/preview/` — превью JSON
