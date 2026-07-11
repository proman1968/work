# WORK sources

Эта папка содержит код движка WORK: серверный запуск, объектную модель, клиентские proxy-классы и прикладные модули.

Главный принцип структуры: поведение должно жить в классе, которому оно принадлежит. Если метод общий для нескольких классов, он поднимается в ближайший общий базовый класс. Отдельные helper/shared-файлы допустимы только для действительно универсальных функций без владельца.

## Entry Points

- `work.js` — серверный entrypoint. Создает `WORK = new $server()`, запускает HTTP/HTTPS, WebSocket и STUN.
- `client.js` — клиентский entrypoint. Загружает ODA, клиентскую модель `client/`, регистрирует `WORK`, UI-обвязку и браузерные сервисы.
- `page.html` — шаблон страницы handler'а. Сервер подставляет `{item_path}`, `{handler}`, `{view_name}` и другие значения.
- `tester.html` — шаблон тестовой страницы для файлов, которые открываются через серверный test-механизм.

## Core Model

WORK построен вокруг `$item`.

`core.js` — общий абстрактный базовый класс `$item extends Reactor`. Содержит среда-независимый код: `DATA`, путь, признаки типа, `genGUID`, статические реестры `LISTS`/`ITEMS`. От него наследуются обе ветви — серверная и клиентская.

Серверная сторона работает с реальными файлами, папками и данными на диске. Клиентская сторона содержит proxy-классы с теми же базовыми сущностями и обращается к серверным двойникам через `WORK.fetch()`.

`$public` на сервере описывает свойства, которые сериализуются и передаются клиенту как публичный прототип proxy-элемента. Свойства, которых нет в `$public`, клиент добирает лениво через серверные методы.

## `server/`

Серверная объектная модель. Эти классы отвечают за файловую систему, наследование, загрузку и сохранение данных. Каждый файл = один класс (кроме `index.js`).

- `index.js` — сборка серверного `CORE` и registry `FS` (порядок инициализации классов).
- `$server.js` — `$server` (бывший `WorkServer`): корневой серверный `$storage`, HTTP-сессии, merge `data.js`, шаблоны страниц.
- `folder.js` — `$folder`: дерево элементов, `children`, `get_item`, `tilde`, manifest, сортировка.
- `storage.js` — `$storage`: `data.js`, merge/diff, logs, secrets, metadata. Модель наследования: [`../docs/storage-inheritance.md`](../docs/storage-inheritance.md).
- `file.js` — `$file`: load/save, history, restore, file-specific behavior. Переопределён `collect_tilde` — для файлов tilde ищет через глобальную цепочку типов (`WORK.$folder → $file → $prompt`), а не через локальные мета-папки.
- `llm.js` — `$llm extends $storage`: подключение к внешним языковым моделям. Методы: `chat()` (полный ответ), `streamChat()` (AsyncGenerator). Протоколы: `openai`, `anthropic`, `gigachat` (OAuth + self-signed SSL).
- `user.js` — `$user`: пользовательская storage-сущность.

## `client/`

Клиентская proxy-модель. Классы повторяют серверные сущности, но вместо прямой работы с диском обращаются к серверу.

- `index.js` — сборка клиентского `CORE` и реэкспорт `$item` из `../core.js`.
- `folder.js` — клиентский `$folder extends $item` (из `core.js`): `url`, `open_url`, `fetch`, `get_item`, browser actions, `save_file`, `load`, `save`, `delete`, `create`.
- `storage.js` — клиентский `$storage`: import/save `data.js`, metadata, fields, data access.
- `file.js` — клиентский `$file`. Переопределён `load()` — возвращает сырые данные через `WORK.fetch()` без `__bind` (для чтения JSON-файлов вроде `task.ai`). `reset()` очищает `body` и кэш.
- `user.js` — клиентский `$user`.
- `handler.js` — клиентская модель handler'а.
- `field.js` — клиентская модель поля/описателя данных.

## `host/`

Серверный runtime и инфраструктура. Эти файлы не являются частью объектной модели, они обеспечивают запуск и протоколы.

- `config.js` — env-конфигурация: host, ports, TLS, dev mode, challenge TTL.
- `security.js` — функции контроля доступа: `allowAccess`, `canSee`, `canWrite`, `filterHttpTreeResult`, `METHOD_ACCESS`.
- `http-server.js` — запуск HTTP/HTTPS, разбор запроса, cookies, routing методов.
- `websocket.js` — WebSocket-события.
- `stun.js` — локальный STUN для WebRTC.
- `auth-methods.js` — login/register/session methods (примешиваются в прототип `$server`).
- `file-handlers.js` — реакции на сохранение файлов (`task.ai`, `message.txt`, `files.pack`, `outbox.eml`…).
- `skill-manager.js` — запуск и контроль выполнения скиллов.
- `skill-router.js` — роутинг запросов к скиллам (эмбеддинги + keyword fallback).
- `mail.js`, `email-utils.js` — почта и EML.
- `push.js`, `vapid.js` — push subscriptions.
- `babel-merge.js` — merge `data.js` по слоям наследования (через Babel AST).
- `package-install.js` — установка npm-пакетов.
- `gen-api.js` — клиент внешнего GenAPI (генерация изображений).

## `modules/`

Прикладные и тяжелые модули, которые не являются ядром объектной модели.

- `embeddings/` — embeddings/RAG support (Xenova, kreuzberg).
- `call/` — WebRTC call support.
- `user-profile/` — клиентский UI профиля пользователя.

В `modules/` не должны попадать базовые helpers ядра.

## Public Static

- `manifest.json` — PWA manifest.
- `page.html` — runtime-шаблон handler-страниц.
- `tester.html` — runtime-шаблон тестовых страниц.

Публичные пути должны быть стабильными, потому что на них ссылается сервер и браузерный runtime.

## Placement Rules

1. Метод объекта должен жить в классе этого объекта.
2. Общий метод нескольких объектов поднимается в ближайший общий базовый класс.
3. Серверная инфраструктура живет в `host/`.
4. Серверная доменная модель живет в `server/`.
5. Клиентская proxy-модель живет в `client/`.
6. Прикладные интеграции и тяжелые внешние модули живут в `modules/`.
7. Не создавать новые `helpers`, `shared`, `utils` без явного владельца и причины.
8. Не держать demo/sandbox-файлы внутри `sources`; такие файлы должны быть удалены или вынесены в отдельные examples вне ядра.
9. Имя файла в `server/` и `client/` должно совпадать с именем класса в нём (например, `folder.js` → `$folder`).

## Принципы архитектуры

1. **МИНИМАЛИЗМ** — код должен быть минимальным. `ai-preview` — ~100 строк, не 800. Меньше кода — меньше ошибок.
2. **Поведение в классе-владельце** — метод живёт в классе объекта, которому принадлежит. Общий метод поднимается в базовый класс.
3. **Методы ядра, не костыли** — использовать существующие методы (`load()`, `get_item()`, `fetch()`), а не прямые HTTP-вызовы или хардкод путей.
4. **Реактивная модель** — геттеры + события `changed`/`reset()` для автообновления. Не поллинг.
5. **`__bind` только для дерева** — `fetch()` — транспорт, `__bind` — привязка к дереву элементов. `load()` не должен оборачивать результат.

## $llm — внешние языковые модели

`$llm extends $storage` (`sources/server/llm.js`) — единый интерфейс для LLM провайдеров.

- `chat(messages, options)` — полный ответ
- `streamChat(messages, options)` — AsyncGenerator для стриминга
- Протоколы: `openai` (Bearer), `anthropic` (x-api-key), `gigachat` (OAuth + self-signed SSL), `custom`

Структура провайдера:
```
services/LLM/$llm/data.js                    — мета-тип (поля настройки)
services/LLM/<Провайдер>/<Модель>/$llm/data.js — конкретная модель
```

## Triggers (~/triggers/on_save)

Триггер `on_save` — реакция на сохранение файла. Ищется через двойную тильду:

```
~/triggers/on_save/~/data.js
```

- **Первая `~`** — `collect_tilde` для типа файла. Для `$file` переопределён: ищет через глобальную цепочку типов (`WORK.$folder → $file → $prompt`), а не через локальные мета-папки внутри файла.
- **Вторая `~`** — поиск `data.js` внутри мета-папок `on_save` (через `$trigger`).
- **Результат** — массив `data.js`, мерджится через `$server.mergeFiles`, импортируется через `$folder.importScript`.

Структура триггера на диске (через `steps`):

```
$server/$folder/$file/$prompt/triggers/on_save/$trigger/data.js
```

- `$folder` — корневой типизатор (начало цепочки `steps`)
- `$file/$prompt` — цепочка типов от расширения файла (`.prompt`)
- `triggers/on_save` — папка триггера
- `$trigger` — мета-тип (как `$handler`), содержит `data.js` с методом `execute(params)`

Вызов триггера — в `sources/server/file.js`, метод `save_to_log`, через `queueMicrotask`.

### ai-preview — микрочат для task.ai

`ai-preview` (~100 строк) — компонент-превью для `task.ai`.

- `get includes()` — геттер: `$item.load()` → JSON → `includes` → `WORK.get_item(p, 'info')` → массив экземпляров
- `$item.listen('changed')` → инвалидация кэша `includes` → автообновление
- `send()` — `save_file('message.prompt')` в storage владельца
- `compact` режим в `chat-item`: `flex` + `raised` вместо `shadow`

### task.ai — носитель микрочата

`task.ai` — файл-контейнер для микрочата с ИИ. Создаётся триггером `on_save` при первом `message.prompt`. Содержит JSON:

```json
{ "content": "", "includes": ["/path/to/prompt", "/path/to/response.md"] }
```

- `includes` — история диалога (prompts и responses в порядке)
- Отсутствие LLM-исполнителя не отменяет создание `task.ai` — он хранит includes для последующего выполнения
