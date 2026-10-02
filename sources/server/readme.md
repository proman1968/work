# sources/server/ — серверные классы FS

Серверная объектная модель. Реальная работа с файловой системой: чтение, запись, наследование, логи, доступ. RAG — отдельный модуль `sources/modules/rag` (ядро вызывает его фасад).

## Файлы

- `index.js` — сборка `CORE` и registry `FS`: `$folder`, `$class`, `$handler`, `$user`, `$file`
- `folder.js` — `$folder`: дерево элементов, `children`, `get_item`, `tilde`, `info`, `save_file` (новое имя — `safeNodeName`), `find_text`, `get_schema`, `services_schema`
- `class.js` — `$class`: `class.js`, merge/diff, logs, secrets, metadata, `save_message`; `create` нормализует id через `safeNodeName` (тег `$ai` → поле `model`)
- `safe-node-name.js` — имя сегмента пути = имя на диске (без `:` `/` `\`)
- `file.js` — `$file`: load/read_text/save/edit, history, RAG, триггеры `on_save` (типа и собственного класса: `<мета>/triggers/<имя>/$trigger/`)
- `handler.js` — `$handler extends $class`: исполняемый элемент (execute в class.js)
- `user.js` — `$user`: пользовательская storage-сущность, online-статус
- `server.js` — `$server`: корневой серверный `$class`, HTTP-сессии, merge `class.js`
- `node.js` — `$node`: узел сети WORK в реестре `/NODES` (корень реестра — тоже `$node`): `node_add`, `node_refresh`, `network_graph`, `remote`
- `access/policy.js` — политика доступа (чистые правила): области, роли (`scope`/`feed`/`write`/`principals`), canRead/canWrite; единая для ядра и RAG
- `access/refs.js` — индекс лент: что открывает субъекту запись в его кабинете (`path`/`includes`)
- `access/gateway.js` — шлюз вызова методов извне (HTTP, агент, узлы): реестр `MEMBERS` и уровни доступа, CSRF, фильтр результатов
- `access/audit.js` — журнал безопасности (`.index/audit`)

## Ключевые механизмы

- **Наследование** — `~` (tilde) и merge `class.js` по слоям. `_collect_tilde`: ось `WORK.$folder` → meta верхнего `$class` с тем же `type` → локальная `meta/$folder` → SELF
- **`get_schema()`** — схема методов для ИИ-агента (прототип + функции экземпляра после `init`, включая `$method`)
- **`services_schema()`** — реестр внешних сервисов (`SERVICES/`): свод `SCHEMA + capabilities` провайдеров для discovery агентами (подробно — `SERVICES/readme.md`)
- **`static sourceUrl = import.meta.url`** — для парсинга JSDoc из исходника
- **`save_file` → `save_to_history`** — обычный файл: живая копия в зоне роли + снимок в `history/` + лог. **Объект** (расширение из `DATA_EXTS`, сейчас `.data`): точка `DATA/YYYY-MM-DD/{time}.{uid}.{ext}` (адрес вычисляется из id), `name` из тела (иначе stem пути), `time` из корня тела (иначе `params.time` / now), лог без копии в `history/`; пишут методы-владельцы (`create/update/delete_object`, прямая запись — только ADMIN); поля проверяются по `METADATA.FIELDS`. Остальные файлы данных (`$file/$ext` с `METADATA`: `.eml`, `.ics`, `.task`) — пока в зоне роли. Новое имя обычного файла — `safeNodeName`

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
- **Область** элемента — первая папка после последнего `$…` виртуального пути: имя объявленной роли → зона роли; `DATA` → объекты (общая зона точки); `INDEX` → производные агрегаты; `logs` → лента точки; `#secret`/`#system` → секреты; иначе → система. Документы ролей — в зонах (`$structure`); объекты `.data` — в `DATA`; `DATA`/`INDEX`/`logs` ролью не объявить (`RESERVED_ZONE_NAMES`)
- **Роли** объявляются в `ROLES` class.js (сборка по `~`): базовые ADMIN, BOSS, USER, GUEST + прикладные (`CUSTOMER` и т.п., по умолчанию как USER). Поля: `scope` (`point`|`subtree` — видит вниз по дереву), `feed` (`own`|`point` — видит ленту точки), `write` (`zone`|`all`), `key` (поле назначений в `#security`, по умолчанию `ROLE + 'S'`), `label`
- **Чтение**: система, `DATA`, `INDEX` — любой назначенной роли (видимость класса — через `canSee`); зона — своей роли (собственная и унаследованная); лента точки — `feed=point` (ADMIN, BOSS), остальным — свои записи (автор/получатель); секреты — ADMIN; `scope=subtree` — всё вниз по дереву. Плюс всё, на что указывает запись в собственной ленте пользователя (`receivers` доставляют запись в кабинет — индекс лент `access/refs.js`)
- **Запись**: ADMIN — всё вниз по дереву; остальные — только своя зона и только где роль назначена локально; `DATA`/`INDEX` напрямую — только ADMIN, остальные пишут объекты через метод-владелец `create_object` (ADMIN или USER с локальным назначением)
- **Вложения** (`includes` в `save_message`/`append_log_includes`/`save_file`) — только видимые автору (иначе лента стала бы обходом прав)
- **Исполняемое и системное**: `class.js`, сегменты `$…` (типизаторы — сервер импортирует их class.js), `#…`, скрытые `.…` создаёт/меняет только роль с `write: 'all'`; имена и `params.folder` нормализуются (`safeRelPath`), итоговый путь проверяется «внутри папки» (`assertInside`); элемент с id `.`/`..` не создаётся
- **Субъекты** (`principals`): `user` — пользователь сервера, `node` — узел сети WORK (другой сервер, действующий через своего представителя). ADMIN/BOSS и роли с `write: 'all'` узлам не выдаются; узел получает только роли, заявленные его представителем в подписанном запросе; в своём классе реестра узел видит только ленту отношений. В записях логов от узла — `sender` = id узла, `actor` = `uid@узел`
- **Методы снаружи** — только через шлюз (`access/gateway.js`); новый публичный метод ядра нужно добавить в `MEMBERS` с уровнем, метод class.js — объявить `ACCESS: {имя: 'public'|'user'|'read'|'call'|'write'|'admin'}` (по умолчанию `call`)
- `declared_roles` — объявленные роли точки; `roles(params)` — роли пользователя (subtree-роли — с наследованием сверху); `hasLocalRole(params, role)`; `areaOf(item)` / `resolveZone(item)` — область элемента; `canSee` / `canWrite` — через политику
- `members({role, inherited})` — назначенные пользователи класса (роли — массивы `#security.ADMINS`/`BOSSES`/`USERS`/`GUESTS`, прикладные — `#security[key]`); ролевые геттеры `admins`/`bosses`/`users`/`guests` — локальные назначения, `allAdmins`/`allBosses` — включая вышестоящие классы, `assignedUsers` — реактивные обёртки для UI
- `LINKS` в `class.js` группы (`$group`): `[{ id: '/ПУТЬ', access: 'read'|'write' }]` — ссылки рабочего места на прикладные классы (на всё поддерево); реестр `access/links.js`, сброс при `save()` группы; `data_access(params)` — `'admin'`| `'write'`| `'read'`| `null` (назначения плюс ссылки, кроме структурных типов); `canSee`/`canWrite`/`_assertDataWrite`/`split`/`rebuild_index` учитывают ссылки
- `assertAccess(params, level)` — проверка доступа, бросает при отказе; deprecated-алиас: `allowAccess`
- `work_zone({role})` — папка роли в метапапке для `save_file`; имя = `role` или `GUEST`; `DATA`/`INDEX`/`logs` отклоняются; deprecated-алиас: `get_storage`
- `data_zone()` — общая зона `DATA` метапапки для объектов; `DATA_EXTS` (`['data']`) — расширения объектов общей зоны; `is_data_zone_type(ext)`; `create/update/delete/read_object({id, …})`, `query`, `split` — API объектов (в шлюзе: запись — WRITE, чтение — READ)
- deprecated: `$class.ZONES` / `ZONES_MAP` (зона = имя роли)

### Описание элемента

- `get_schema()` — схема свойств/методов (инструменты агента)
- `info({deep, mask, items})` — текущее состояние; с `deep` — дерево состояния
- `json_model` — внутренний снимок $public-свойств (используется в `info` и `get_schema`), наружу не является каноном

### Сохранение (семейство save / edit)

| Имя | Где | Смысл |
|---|---|---|
| `save()` | `$folder` | mkdir этой папки |
| `save({ post })` | `$class` | сохранить `class.js` (слои); `METADATA.FIELDS`/`INDEXES`/`POSTINGS` наследуются однотипными потомками через `$distr_folder` (кроме `to_inherit: false`) |
| `save({ post })` | `$file` | перезаписать содержимое этого файла |
| `edit({ post })` | `$file` | точечная правка SEARCH/REPLACE; deprecated-алиас: `edit_file` |
| `save_file({ filename, post })` | `$folder`/`$class` | обычный файл → зона роли, history + лог; объект (`DATA_EXTS`) → `DATA/<дата>/` + лог; остальные файлы данных (`METADATA`) → зона роли, точка в папке ext + лог |
| `create_object({filename\|name, post\|body})` | `$class` | метод-владелец: новый объект в `DATA` (ADMIN или USER с локальным назначением; только в листе); `name` из тела, поля — по `METADATA.FIELDS` |
| `update_object({id, post\|body, restore?})` | `$class` | новая версия на месте (имя файла стабильно), прежняя — в `.{leaf}/history/`; удалённый — только с `restore: true` |
| `delete_object({filename\|name})` | `$class` | отметка `deleted` (файл остаётся, версия — в историю) |
| `read_object({filename\|name})` | `$class` | текущая версия объекта |
| `query({where, from?, to?, ext?, include_deleted?, limit?, order?})` | `$class` | выборка по поддереву того же типа из файлов (не индекса), только пакеты дней из периода; `where`: равенство, `[...]` как $in, `{gte,lte,gt,lt,ne,eq,in,like}` |
| `split({child})` | `$class` | перенос `DATA` в пустого потомка того же типа (создаёт его); только write=all; факт — `save_message` |
| `save_files` | `$folder` | батч файлов + одна `save_message` |
| `save_message({ message, includes })` | `$class` | чистая лог-запись без файла |
| `ensure_folder({ id })` | `$folder` | создать дочернюю папку по имени |

### Логи ($class, внутренности — `logs.js`)

- `logs({mode})` — единая точка чтения: `folder` (папка дня, default) | `bodies` | `index` | `files` | `dates`. Журнал: `<meta>/logs/YYYY-MM-DD/{time}.{uid}.logs` (файл данных, не `.data.logs/history`). `feed: 'point'` — общая лента класса (почта): чтение из журнала класса без фильтра «только свои» (только `mode: 'dates'` или `ext` из типов данных класса), запись — без копии в кабинет автора
- `read_log_entry({path})` — одна запись по stub `.logs` или связанному `row.path`
- `append_log_includes({entryPath, includePaths})` — дописать includes записи
- deprecated-алиасы: `logs_dates`, `log_files`, `read_log_bodies`, `log_index`, `appendLogIncludes`

Deprecated-алиасы удерживаются до миграции всех вызывающих, новые вызовы — только канон.

## TODO

- [ ] Сборка `~/readme.md` в ядре: ветка `~` в `get_item` (`folder.js`) для `id==='readme.md'` возвращает один виртуальный файл (прокси ближайшего слоя, `read_text/load/download` отдают `$server.mergeTextFiles` по тем же слоям). Остальные `~` — массивами как сейчас. После этого удалить: спецветку в `http-server.js` (отдача сборки), `readme_merged()` в `folder.js`, `~/`-блоки чтения readme в `agents/explore.js` и `agents/work.js` (вернуть прямое чтение). Одна ветка в ядре вместо четырех мест.
