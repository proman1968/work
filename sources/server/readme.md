# sources/server/ — серверные классы FS

Серверная объектная модель. Реальная работа с файловой системой: чтение, запись, наследование, логи, RAG.

## Файлы

- `index.js` — сборка `CORE` и registry `FS`: `$folder`, `$class`, `$handler`, `$user`, `$file`
- `folder.js` — `$folder`: дерево элементов, `children`, `get_item`, `tilde`, `info`, `save_file`, `find_text`, `get_schema`
- `class.js` — `$class`: `class.js`, merge/diff, logs, secrets, metadata, `save_message`
- `file.js` — `$file`: load/read_text/save/edit, history, RAG, триггеры `on_save`
- `handler.js` — `$handler extends $class`: исполняемый элемент (execute в class.js)
- `user.js` — `$user`: пользовательская storage-сущность, online-статус
- `server.js` — `$server`: корневой серверный `$class`, HTTP-сессии, merge `class.js`

## Ключевые механизмы

- **Наследование** — `~` (tilde) и merge `class.js` по слоям. `collect_tilde`: ось `WORK.$folder` → meta верхнего `$class` с тем же `type` → локальная `meta/$folder` → SELF
- **`get_schema()`** — схема методов для ИИ-агента (через `buildAiSchema`, канон = стандартный JSDoc `@param`/`@returns`)
- **`static sourceUrl = import.meta.url`** — для парсинга JSDoc из исходника
- **`save_file` → `save_to_history`** — return = history path снимка (карточка file в ai.task показывает его)

## Словарь API (канон имён)

API элементов — это «система команд» для ИИ-агентов: имя обязано однозначно называть операцию.

### Списки детей

| Имя | Содержимое |
|---|---|
| `children` | все дочерние (включая скрытые, метапапки, унаследованное) |
| `entries` | записи каталога: `children` без скрытых (папки + файлы) |
| `items` | бизнес-видимые: `entries` без `$…` и `.…` |
| `files` | только файлы из `entries` |
| `folders` | только папки из `entries` |

### Навигация и наследование

- `parent` — родитель по файловому пути
- `$parent` — ближайший типизированный родитель ($class)
- `$owner` — класс-владелец (через метапапку)
- `inherit_ancestor` — донор наследования (ось типизаторов, НЕ путь); deprecated-алиас: `ancestor`
- `type_chain` — цепочка типизаторов (`['$file', '$smoke']`); deprecated-алиас: `steps`
- `get_item(path)` — разрешение пути (`~`, `//`, `*`, `@prop`)

### Поиск

- `get_item` — по пути; `find_text` — по содержимому (grep); `semantic_search` — RAG-поиск (deprecated-алиас: `search`)
- `find_item({name, types_only})` — рекурсивный поиск элемента по имени (внутренняя позиционная форма: `find_item(name, filterFn)`)

### Роли и доступ

- `members({role, inherited})` — назначенные пользователи класса (роли — массивы `#security.ADMINS`/`BOSSES`/`USERS`/`GUESTS`); ролевые геттеры `admins`/`bosses`/`users`/`guests` — локальные назначения, `allAdmins`/`allBosses` — включая вышестоящие классы, `assignedUsers` — реактивные обёртки для UI
- `assertAccess(params, level)` — проверка доступа, бросает при отказе; deprecated-алиас: `allowAccess`
- `work_zone({role})` — папка рабочей зоны роли (GUEST → `meta_folder/guests`); deprecated-алиас: `get_storage`

### Описание элемента

- `get_schema()` — схема свойств/методов (инструменты агента)
- `info({deep, mask, items})` — текущее состояние; с `deep` — дерево состояния
- `json_model` — внутренний снимок $public-свойств (используется в `info` и `get_schema`), наружу не является каноном

### Сохранение (семейство save / edit)

| Имя | Где | Смысл |
|---|---|---|
| `save()` | `$folder` | mkdir этой папки |
| `save({ post })` | `$class` | сохранить `class.js` (слои) |
| `save({ post })` | `$file` | перезаписать содержимое этого файла |
| `edit({ post })` | `$file` | точечная правка SEARCH/REPLACE; deprecated-алиас: `edit_file` |
| `save_file({ filename, post })` | `$folder`/`$class` | создать/перезаписать файл в папке (→ history → log) |
| `save_files` | `$folder` | батч файлов + одна `save_message` |
| `save_message({ message, includes })` | `$class` | чистая лог-запись без файла |
| `ensure_folder({ id })` | `$folder` | создать дочернюю папку по имени |

### Логи ($class, внутренности — `logs.js`)

- `logs({mode})` — единая точка чтения: `folder` (папка дня, default) | `bodies` | `index` | `files` | `dates`
- `read_log_entry({path})` — одна запись по пути history-файла
- `append_log_includes({entryPath, includePaths})` — дописать includes записи
- deprecated-алиасы: `logs_dates`, `log_files`, `read_log_bodies`, `log_index`, `appendLogIncludes`

Deprecated-алиасы удерживаются до миграции всех вызывающих, новые вызовы — только канон.
