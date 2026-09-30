# $server/$folder/$file/ — тип файлов

Прототип всех файлов в системе. Класс `$file extends $folder` — файл как элемент дерева.

## Структура

- `class.js` — конфигурация базового типа файла
- `$task/` — ИИ-задача (`ai.task`, PDCA/PIPE, preview)
- `$prompt/` — файлы промптов
- `$txt/`, `$md/`, `$html/`, `$eml/`, `$ics/`, `$msg/` — типы по расширениям
- `$ics` — событие календаря: `when` + `METADATA.FIELDS`; файл данных
- `$image/`, `$video/`, `$audio/` — медиа-типы
- `$office/` — документы Office
- `$pack/` — пакеты файлов
- `$log/`, `$xml/`, `$ipynb/`, `$devs/`, `$call/`, `$skill/` — специализированные типы

## Методы `$file`

- `load()` — чтение содержимого
- `read_text()` — текст: sniff байтов (не только расширение), utf-8 / html, Kreuzberg, запасной разбор таблиц (SheetJS)
- `save()` — сохранение (перезапись)
- `edit()` — точечное редактирование через SEARCH/REPLACE (deprecated-алиас: `edit_file`)
- `download()` — скачивание как потока
- `get_imports()` — список import-операторов

## Файлы данных

Объект (`.data`, схема — `METADATA.FIELDS` класса-владельца) — **не живая копия + `history/`**: `save_file` через `create_object` кладёт точку в общую зону `DATA/ext/…/YYYY-MM-DD/`; день и id — `time` в корне JSON (иначе `params.time` / сейчас); имя на диске `{time}.{uid}.data`; поле `name` = stem пути. Лог.path = этот файл. Остальные типы данных (`$file/$data/$ext`: `.eml`, `.ics`, `.task`) — пока в зоне роли. `$logs` — тот же закон: журнал класса в `logs/YYYY-MM-DD/`, не `.data.logs/history`.

## История и триггеры

Обычный файл при сохранении копируется в `history/`. Файл данных — нет. Срабатывает триггер `on_save` (если определён для типа).