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
- `access/policy.js` — политика доступа (чистые правила): области, роли (`label`/`icon`/`color`/`principals`), canRead/canWrite; единая для ядра и RAG
- `access/refs.js` — индекс лент: что открывает субъекту запись в его кабинете (`path`/`includes`)
- `access/gateway.js` — шлюз вызова методов извне (HTTP, агент, узлы): реестр `MEMBERS` и уровни доступа, CSRF, фильтр результатов
- `access/audit.js` — журнал безопасности (`.index/audit`)

## Ключевые механизмы

- **Наследование** — `~` (tilde) и merge `class.js` по слоям. `_collect_tilde`: ось `WORK.$folder` → meta верхнего `$class` с тем же `type` → локальная `meta/$folder` → SELF
- **`get_schema()`** — схема методов для ИИ-агента (прототип + функции экземпляра после `init`, включая `$method`)
- **`services_schema()`** — реестр внешних сервисов (`SERVICES/`): свод `SCHEMA + capabilities` провайдеров для discovery агентами (подробно — `SERVICES/readme.md`)
- **`static sourceUrl = import.meta.url`** — для парсинга JSDoc из исходника
- **`save_file` → `save_to_history`** — обычный файл: живая копия в зоне роли + снимок в `history/` + лог. Файлы данных (`$file/$ext` с `point: true` и `$data`: `.eml`, `.ics`, `.task`, `.logs`) — точка дня в зоне роли или ленте (`save_data_file`). Новое имя обычного файла — `safeNodeName`
- **Прикладные данные** (объекты справочников и операций, проводки) — учётное ядро `sources/data` (SQLite): методы `db_*` в прототипе `$class`, уровни — в шлюзе; чтение — видимость класса и `scope` ссылок рабочих мест (`sources/data/scope.js`: подразделение, место, автор; у предка ссылок — только их ветки), запись — `_assertDataWrite` и место записи пользователя. Инвариант листа в `create`: у класса ядра с объектами нельзя создать дочерний класс того же типа

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
- **Область** элемента — первая папка после последнего `$…` виртуального пути: имя объявленной роли → зона роли; `DATA`/`INDEX` → зарезервированные области (прежнее файловое хранение объектов, сейчас не используются); `logs` → лента точки; `#secret`/`#system` → секреты; иначе → система. Документы ролей — в зонах (`$structure`); `DATA`/`INDEX`/`logs` ролью не объявить (`RESERVED_ZONE_NAMES`)
- **Роли**: системные ADMIN и BOSS (поведение в коде) + остальные в `ROLES` class.js (сборка по `~`): USER, GUEST, прикладные (`CUSTOMER` и т.п.). Поля: `label`, `icon`, `color`, `principals` (`user` и/или `node`; системные — только `user`). Ключ назначений в `#security` — id роли
- **Чтение**: система, `DATA`, `INDEX` — любой назначенной роли (видимость класса — через `canSee`); зона — своей роли (собственная и унаследованная); лента точки целиком — ADMIN и BOSS, остальным — свои записи (автор/получатель); секреты — ADMIN; системные роли действуют от точки назначения вниз по дереву. Плюс всё, на что указывает запись в собственной ленте пользователя (`receivers` доставляют запись в кабинет — индекс лент `access/refs.js`)
- **Запись**: ADMIN — всё вниз по дереву; остальные — только своя зона и только где роль назначена локально; объекты учётного ядра — методами `db_*` (`_assertDataWrite`: ADMIN, роль с локальным назначением или `write`-ссылка рабочего места)
- **Вложения** (`includes` в `save_message`/`append_log_includes`/`save_file`) — только видимые автору (иначе лента стала бы обходом прав)
- **Исполняемое и системное**: `class.js`, сегменты `$…` (типизаторы — сервер импортирует их class.js), `#…`, скрытые `.…` создаёт/меняет только ADMIN; имена и `params.folder` нормализуются (`safeRelPath`), итоговый путь проверяется «внутри папки» (`assertInside`); элемент с id `.`/`..` не создаётся
- **Субъекты** (`principals`): `user` — пользователь сервера, `node` — узел сети WORK (другой сервер, действующий через своего представителя). Системные роли (ADMIN, BOSS) узлам не выдаются; узел получает только роли, заявленные его представителем в подписанном запросе; в своём классе реестра узел видит только ленту отношений. В записях логов от узла — `sender` = id узла, `actor` = `uid@узел`
- **Методы снаружи** — только через шлюз (`access/gateway.js`); новый публичный метод ядра нужно добавить в `MEMBERS` с уровнем, метод class.js — объявить `ACCESS: {имя: 'public'|'user'|'read'|'call'|'write'|'admin'}` (по умолчанию `call`)
- `declared_roles` — объявленные роли точки; `roles(params)` — роли пользователя (системные — с наследованием сверху); `hasLocalRole(params, role)`; `areaOf(item)` / `resolveZone(item)` — область элемента; `canSee` / `canWrite` — через политику
- `members({role, inherited})` — назначенные пользователи класса (роли — массивы `#security` по id роли; в USER входят и назначенные на прикладные роли); ролевые геттеры `admins`/`bosses`/`users`/`guests` — локальные назначения, `allAdmins`/`allBosses` — включая вышестоящие классы, `assignedUsers` — реактивные обёртки для UI
- `#security` подразделения (`$structure` и наследники): общие `LINKS` (`[{ id: '/ПУТЬ', access: 'read'|'write', scope?: 'own'|'place'|'unit'|'all' }]` — всем назначенным; `scope` — видимость данных учётного ядра) и дерево прикладных ролей `ROLES` (`[{ id, label, USERS, LINKS, ROLES }]` — должности без зон-папок); нормализация и расчёт — `access/workplaces.js`, реестр — `access/links.js`, сброс при `save()` структуры; `data_access(params)` — `'admin'`| `'write'`| `'read'`| `null` (назначения плюс ссылки, кроме структурных типов; `directAccess` — только назначения класса, `scopeLinks` — ссылки на класс, его предков и поддерево с отношением пользователя для видимости по `scope`); `places(params)` — дерево мест с флагами mine и готовыми цепочками ссылок (`tree` у места, `commonTree` — общие) для ветки настройки в дереве; `canSee`/`canWrite`/`_assertDataWrite` и чтение `db_*` учитывают ссылки
- `assertAccess(params, level)` — проверка доступа, бросает при отказе; deprecated-алиас: `allowAccess`
- `work_zone({role})` — папка роли в метапапке для `save_file`; имя = `role` или `GUEST`; `DATA`/`INDEX`/`logs` отклоняются; deprecated-алиас: `get_storage`
- deprecated: `$class.ZONES` / `ZONES_MAP` (зона = имя роли)
- **Производительность дерева**: строка дерева не должна ходить на сервер за мелочами. Сервер кладёт готовые признаки в данные элемента (`info` и списки `@items`): `roleIds` (`{ADMIN, BOSS, USER, GUEST}` — uid локальных назначений; клиентские `users`/`bosses`/`admins`/`guests` берут пользователей из общего списка `/USERS`, а не отдельным запросом). Пользователи в строке дерева не показываются. Справка (`readme.md`) открывается только из меню хендлером `$folder/handlers/methods/help` через `readme_merged`, в строке дерева её нет. `info({deep})` отдаёт у вложенных элементов `hasItems` (есть ли дети — для стрелки раскрытия), `branch: 'classes'` — вглубь только по классам. Дерево грузит первый слой одним запросом `info?deep=3&branch=classes` от точки входа (`prefetchDeep`), стрелку рисует по `hasItems`, детей при раскрытии берёт через `info?deep=1` (а не `@items`); после события `changed` флаг снимается и проверяется по `items`. `@storage_folder` — серверная метапапка, клиенту не нужна. В режиме отладки клиент считает свойства, ушедшие в `_onEmpty` (`WORK.emptyHits`), замер — `node tests/perf/tree-load.mjs [--max=N] [--paths]`
- **Кэши и уведомления**: `host/watch.js` реагирует только на код и тексты слоёв (`isCodeChange`; `DATA`, `INDEX`, `history`, `logs` — нет, иначе каждая проводка сбрасывала бы кэши); `reset()` шлёт WebSocket-сообщение подписчикам самого элемента и его свойств-списков (`isSubscribedTo`), а не всем потомкам по префиксу пути; `host/prewarm.js` прогревает 2 верхних уровня классов в фоне после старта (`WORK_PREWARM=0` — выключить, `WORK_PREWARM_LOG=1` — вывести итог)

### Описание элемента

- `get_schema()` — схема свойств/методов (инструменты агента)
- `info({deep, mask, items})` — текущее состояние; с `deep` — дерево состояния
- `json_model` — внутренний снимок $public-свойств (используется в `info` и `get_schema`), наружу не является каноном

### Сохранение (семейство save / edit)

| Имя | Где | Смысл |
|---|---|---|
| `save()` | `$folder` | mkdir этой папки |
| `save({ post })` | `$class` | сохранить `class.js` (слои). Сохраняются только отличия от предка: поля `METADATA.FIELDS`/`STATIC` сверяются с предком по `id` (рекурсивно по `fields`), совпадающие без изменённых детей не пишутся. Поля с `to_inherit: true` уходят в `$distr_folder`, без пометки — в свою метапапку. `INDEXES`/`POSTINGS` наследуются однотипными потомками всегда (кроме `to_inherit: false`) |
| `save({ post })` | `$file` | перезаписать содержимое этого файла |
| `edit({ post })` | `$file` | точечная правка SEARCH/REPLACE; deprecated-алиас: `edit_file` |
| `save_file({ filename, post })` | `$folder`/`$class` | обычный файл → зона роли, history + лог; файлы данных (`point`/`$data`) → зона роли, точка в папке ext + лог |
| `db_create`, `db_update`, `db_query`, `db_register`, `db_journal`, … | `$class` | объекты, проведение и отчёты учётного ядра — см. [`sources/data/readme.md`](/sources/data/readme.md/~/handlers/pages/form/) |
| `save_files` | `$folder` | батч файлов + одна `save_message` |
| `save_message({ message, includes })` | `$class` | чистая лог-запись без файла |
| `ensure_folder({ id })` | `$folder` | создать дочернюю папку по имени |

### Логи ($class, внутренности — `logs.js`)

- `logs({mode})` — единая точка чтения: `folder` (папка дня, default) | `bodies` | `index` | `files` | `dates`. Журнал: `<meta>/logs/YYYY-MM-DD/{time}.{uid}.logs` (файл данных, не `.data.logs/history`). Общая лента класса (почта): чтение из журнала класса без фильтра «только свои» — системным ролям (только `mode: 'dates'` или `ext` из типов данных класса), запись — без копии в кабинет автора
- `read_log_entry({path})` — одна запись по stub `.logs` или связанному `row.path`
- `append_log_includes({entryPath, includePaths})` — дописать includes записи
- deprecated-алиасы: `logs_dates`, `log_files`, `read_log_bodies`, `log_index`, `appendLogIncludes`

Deprecated-алиасы удерживаются до миграции всех вызывающих, новые вызовы — только канон.

## TODO

- [ ] Сборка `~/readme.md` в ядре: ветка `~` в `get_item` (`folder.js`) для `id==='readme.md'` возвращает один виртуальный файл (прокси ближайшего слоя, `read_text/load/download` отдают `$server.mergeTextFiles` по тем же слоям). Остальные `~` — массивами как сейчас. После этого удалить: спецветку в `http-server.js` (отдача сборки), `readme_merged()` в `folder.js`, `~/`-блоки чтения readme в `agents/explore.js` и `agents/work.js` (вернуть прямое чтение). Одна ветка в ядре вместо четырех мест.
