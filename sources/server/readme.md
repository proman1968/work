# sources/server/ — серверные классы FS

Серверная объектная модель. Реальная работа с файловой системой: чтение, запись, наследование, логи, доступ. RAG — отдельный модуль `sources/modules/rag` (ядро вызывает его фасад).

## Файлы

- `index.js` — сборка `CORE` и registry `FS`: `$folder`, `$class`, `$handler`, `$user`, `$file`
- `folder.js` — `$folder`: дерево элементов, `children`, `get_item`, `tilde`, `info`, `save_file` (новое имя — `safeNodeName`), `find_text`, `get_schema`, `services_schema`
- `class.js` — `$class`: `class.js`, merge/diff, logs, secrets, metadata, `save_message`; `create` нормализует id через `safeNodeName` (тег `$ai` → поле `model`)
- `safe-node-name.js` — имя сегмента пути = имя на диске (без `:` `/` `\`)
- `file.js` — `$file`: load/read_text/save/edit, history, RAG, триггеры `on_save`
- `handler.js` — `$handler extends $class`: исполняемый элемент (execute в class.js)
- `user.js` — `$user`: пользовательская storage-сущность, online-статус
- `server.js` — `$server`: корневой серверный `$class`, HTTP-сессии, merge `class.js`
- `access/policy.js` — политика доступа (чистые правила): области, роли, canRead/canWrite; единая для ядра и RAG
- `access/refs.js` — индекс лент: что открывает пользователю запись в его кабинете (`path`/`includes`)

## Ключевые механизмы

- **Наследование** — `~` (tilde) и merge `class.js` по слоям. `_collect_tilde`: ось `WORK.$folder` → meta верхнего `$class` с тем же `type` → локальная `meta/$folder` → SELF
- **`get_schema()`** — схема методов для ИИ-агента (прототип + функции экземпляра после `init`, включая `$method`)
- **`services_schema()`** — реестр внешних сервисов (`SERVICES/`): свод `SCHEMA + capabilities` провайдеров для discovery агентами (подробно — `SERVICES/readme.md`)
- **`static sourceUrl = import.meta.url`** — для парсинга JSDoc из исходника
- **`save_file` → `save_to_history`** — обычный файл: живая копия + снимок в `history/` + лог. **Файл данных** (у `$file/$ext` есть `METADATA`): точка `ext/…/YYYY-MM-DD/{time}.{uid}.{ext}`, `name` в JSON, `time` из корня тела (иначе `params.time` / now), лог без копии в `history/`. Новое имя обычного файла — `safeNodeName`

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

- `get_item` — по пути; `find_text` — по содержимому (grep); `semantic_search({prompt, k, role, rings, kinds})` — RAG-поиск **от точки** с правами пользователя (модуль `sources/modules/rag`, см. его readme); `query_objects({type, where, limit})` — структурный запрос по объектам `$data` с теми же правами; `rag_status()` / `clear_rag()` (ADMIN) — состояние и сброс индекса поддерева
- `find_item({name, types_only})` — рекурсивный поиск элемента по имени (внутренняя позиционная форма: `find_item(name, filterFn)`)
- `_tilde_layers()` — папки-слои `~` (корень → SELF); `~` = их `inherit_children`, RAG строит по ним проекции точки

### Роли и доступ (модель «Точки × Роли × Ленты», `access/policy.js`)

- **Размещение определяет наследование**, права о нём не знают: файл в `meta/ROLE/` — только эта точка, в `meta/$folder/ROLE/` — все точки ниже, в `meta/$folder/$class/$type/ROLE/` — точки типа ниже
- **Область** элемента — первая папка после последнего `$…` виртуального пути: имя объявленной роли → зона роли; `logs` → лента точки; `#secret`/`#system` → секреты; иначе → система. Бизнес-данные — только в зонах
- **Роли** объявляются в `ROLES` class.js (сборка по `~`): базовые ADMIN, BOSS, USER, GUEST + прикладные (`CUSTOMER` и т.п., по умолчанию как USER). Поля: `scope` (`point`|`subtree` — видит вниз по дереву), `feed` (`own`|`point` — видит ленту точки), `write` (`zone`|`all`), `key` (поле назначений в `#security`, по умолчанию `ROLE + 'S'`), `label`
- **Чтение**: система — любой назначенной роли; зона — своей роли (собственная и унаследованная); лента точки — `feed=point` (ADMIN, BOSS), остальным — свои записи (автор/получатель); секреты — ADMIN; `scope=subtree` — всё вниз по дереву. Плюс всё, на что указывает запись в собственной ленте пользователя (`receivers` доставляют запись в кабинет — индекс лент `access/refs.js`)
- **Запись**: ADMIN — всё вниз по дереву; остальные — только своя зона и только где роль назначена локально
- **Вложения** (`includes` в `save_message`/`append_log_includes`/`save_file`) — только видимые автору (иначе лента стала бы обходом прав)
- `declared_roles` — объявленные роли точки; `roles(params)` — роли пользователя (subtree-роли — с наследованием сверху); `hasLocalRole(params, role)`; `areaOf(item)` / `resolveZone(item)` — область элемента; `canSee` / `canWrite` — через политику
- `members({role, inherited})` — назначенные пользователи класса (роли — массивы `#security.ADMINS`/`BOSSES`/`USERS`/`GUESTS`, прикладные — `#security[key]`); ролевые геттеры `admins`/`bosses`/`users`/`guests` — локальные назначения, `allAdmins`/`allBosses` — включая вышестоящие классы, `assignedUsers` — реактивные обёртки для UI
- `assertAccess(params, level)` — проверка доступа, бросает при отказе; deprecated-алиас: `allowAccess`
- `work_zone({role})` — папка роли в метапапке для `save_file`; имя = `role` или `GUEST`; deprecated-алиас: `get_storage`
- deprecated: `$class.ZONES` / `ZONES_MAP` (зона = имя роли)

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
| `save_file({ filename, post })` | `$folder`/`$class` | обычный файл → history + лог; файл данных (`METADATA`) → точка в папке ext + лог |
| `save_files` | `$folder` | батч файлов + одна `save_message` |
| `save_message({ message, includes })` | `$class` | чистая лог-запись без файла |
| `ensure_folder({ id })` | `$folder` | создать дочернюю папку по имени |

### Логи ($class, внутренности — `logs.js`)

- `logs({mode})` — единая точка чтения: `folder` (папка дня, default) | `bodies` | `index` | `files` | `dates`. Журнал: `<meta>/logs/YYYY-MM-DD/{time}.{uid}.logs` (файл данных, не `.data.logs/history`)
- `read_log_entry({path})` — одна запись по stub `.logs` или связанному `row.path`
- `append_log_includes({entryPath, includePaths})` — дописать includes записи
- deprecated-алиасы: `logs_dates`, `log_files`, `read_log_bodies`, `log_index`, `appendLogIncludes`

Deprecated-алиасы удерживаются до миграции всех вызывающих, новые вызовы — только канон.

## TODO

- [ ] Сборка `~/readme.md` в ядре: ветка `~` в `get_item` (`folder.js`) для `id==='readme.md'` возвращает один виртуальный файл (прокси ближайшего слоя, `read_text/load/download` отдают `$server.mergeTextFiles` по тем же слоям). Остальные `~` — массивами как сейчас. После этого удалить: спецветку в `http-server.js` (отдача сборки), `readme_merged()` в `folder.js`, `~/`-блоки чтения readme в `agents/explore.js` и `agents/work.js` (вернуть прямое чтение). Одна ветка в ядре вместо четырех мест.
