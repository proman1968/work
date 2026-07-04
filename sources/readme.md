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
- `file.js` — `$file`: load/save, history, restore, file-specific behavior.
- `user.js` — `$user`: пользовательская storage-сущность.

## `client/`

Клиентская proxy-модель. Классы повторяют серверные сущности, но вместо прямой работы с диском обращаются к серверу.

- `index.js` — сборка клиентского `CORE` и реэкспорт `$item` из `../core.js`.
- `folder.js` — клиентский `$folder extends $item` (из `core.js`): `url`, `open_url`, `fetch`, `get_item`, browser actions, `save_file`, `load`, `save`, `delete`, `create`.
- `storage.js` — клиентский `$storage`: import/save `data.js`, metadata, fields, data access.
- `file.js` — клиентский `$file`.
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
- `file-handlers.js` — реакции на сохранение файлов (`task.ai`, `message.txt`, `pack.pack`, `outbox.eml`…).
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