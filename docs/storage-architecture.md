# Хранилище WORK

## 1. Что это

Модель хранения WORK: классы, файлы, ленты и прикладные данные. Технически — раскладка метапапки класса и правила движка (`sources/server/`) плюс учётное ядро на SQLite (`sources/data/`). Прикладно — основа учётной системы (справочники, операции, журнал).

## 2. Зачем это нужно

Метаданные и документы остаются файлами дерева: их правят человек и ИИ, они наследуются через `~`. Прикладные данные (объекты справочников и операций, проводки) требуют транзакций, индексов и запросов по иерархии классов — они живут в одной БД `.data/work.db` (решения — [`docs/architecture-v2.md`](/docs/architecture-v2.md/~/handlers/pages/form/)). Прежнее хранение объектов JSON-файлами `DATA/` и агрегатов `INDEX/` в метапапке класса удалено.

## 3. Как это работает

### 3.1. Метаданные класса (`class.js`)

```js
METADATA: {
  STATIC:   [...],  // свойства самого класса (настройки: baseUrl, tariff, …)
  FIELDS:   [...],  // поля объектов класса (наследуются, слияние по id); у счёта — аналитики
  POSTINGS: [...],  // правила проводок ($operation)
}
LINKS: [ { id: '/DATA/REGISTER/50', access: 'read' }, … ]  // только в #security структур ($structure и наследники)
```

`STATIC` — свойства самого класса, не наследуется. `FIELDS` и `POSTINGS` наследуются: при `save()` они попадают и в свой `class.js`, и в наследуемую потомками часть `$distr_folder` (кроме `to_inherit: false`). Учётное ядро собирает схему из собственных слоёв цепочки предков одного семейства (`sources/data/schema.js`). Путь distributive повторяет цепочку типов из `$server` (`$class/$structure/$base`, а не `$class/$base`): тесты-песочницы обязаны копировать и `$server`-звено цепочки.

### 3.2. Раскладка метапапки

```text
<Класс>/$<тип>/
├─ class.js, readme.md            SYSTEM  (правит ADMIN)
├─ #security #secret #system      SECRET
├─ $folder/…                      наследуемое для потомков
├─ logs/YYYY-MM-DD/*.logs         LOGS    факты
└─ <ROLE>/                        ZONE    документы ролей — только $structure
```

Имена `DATA`/`INDEX`/`logs` по-прежнему зарезервированы (`policy.js`): ролью их не объявить.

### 3.3. Файлы и данные

- Объекты справочников и операций, их версии во времени и проводки — учётное ядро ([`sources/data`](/sources/data/readme.md/~/handlers/pages/form/)), методы `db_*` у классов.
- `$eml`, `$ics`, `$call`, `$task`, `$logs` — точечные типы `$file` (`point: true`): запись дня в зоне роли или ленте; `$data` — общий тип файла данных с формой-редактором.
- Каждое действие с файлом = артефакт + факт в логе; правка — новая версия, прежняя в `history`.

### 3.4. Доступ: роль в подразделении и доступ ссылки

Подразделение — класс типа `$structure` или его наследника (`$base`, `$server`). В его `#security`: системные роли ADMIN/BOSS, общие `LINKS` (всем назначенным) и дерево прикладных ролей `ROLES` со своими `USERS` и `LINKS`. Ссылка распространяется на поддерево класса: `read` — чтение, `write` — чтение плюс создание и правка объектов. Ссылки вложенных мест и все ссылки для BOSS — только чтение. Предок ссылки виден как страница (каркас цепочки), но данные его поддерева — только при `data_access`.

## 4. Из чего это состоит

- `sources/server/class.js` — `METADATA` (дефолт `FIELDS`/`STATIC`), `save_file`, `data_access`, `_assertDataWrite`, методы ядра `db_*` в прототипе
- `sources/server/folder.js` — `getFolderToSaveFile`, `save_data_file` (точечные типы и ленты), наследование `~`
- `sources/server/file.js` — `save_to_history`, `save_to_log`, триггеры `on_save`
- `sources/server/logs.js` — факты, ленты, `feed`
- `sources/server/access/policy.js` — области `SYSTEM`/`ZONE`/`LOGS`/`SECRET` (и зарезервированные `DATA`/`INDEX`)
- `sources/data/` — учётное ядро: объекты, проведение, отчёты, методы `db_*`
- `DATA/` — класс «Данные»: `REGISTER/` — журнал (`$register`) и счета (`$account`), `OPERATIONS/` — операции (`$operation`), `CATALOGS/` — справочники (`$catalog`, `$registry`, `$virtual`)

## 5. В каком это состоянии

- ✅ разделение `METADATA` на `STATIC` (свойства класса) и `FIELDS` (поля объектов)
- ✅ точечные типы `$call`/`$eml`/`$ics`/`$logs`/`$task` в `$file` с `point: true`; схема типов — через `$file.typeData`
- ✅ ссылки подразделений (`#security` структур), `data_access`, права через ссылки (реестр `access/links.js`, места `access/workplaces.js`)
- ✅ дерево операций: промежуточные уровни расширяют `FIELDS` и `POSTINGS` (слияние по `id`), лист задаёт однозначные правила (тест `tests/inherit-ops.test.js`)
- ✅ прикладные данные — учётное ядро SQLite; файловое хранение объектов (`DATA/`, `INDEX/`, `overlay.json`) удалено вместе с методами `create/update/delete/read_object`, `query`, `index`, `rebuild_index`, `split`, `read_link`, `post`/`unpost`, `journal`/`sheet`, `browse`/`overlay_save`
- ✅ страница формы: `pickTildeSingle` — среди одноимённых `form` по `~` берётся последний `$handler` (тест `tests/tilde-single.test.js`)

## 6. Дальнейшие планы

- Видимость данных по `scope` рабочих мест (`docs/architecture-v2.md`, Р8)
- `CID` классов демо-конфигурации
