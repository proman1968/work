# sources/host/ — серверный рантайм

Серверная инфраструктура: запуск HTTP/HTTPS, WebSocket, авторизация, merge class.js. Эти файлы не являются частью объектной модели — они обеспечивают работу сервера.

## Файлы

- `config.js` — env-конфигурация: host, ports, TLS, dev mode
- `http-server.js` — запуск HTTP/HTTPS, разбор запроса, routing методов (`execItemMethod`)
- `websocket.js` — WebSocket-события (`changed`, `chat.delta`, `chat.done`)
- `stun.js` — локальный STUN для WebRTC
- `auth-methods.js` — login/register/session (примешиваются в прототип `$server`)
- `babel-merge.js` — merge `class.js` по слоям наследования (Babel AST)
- `vapid.js`, `push.js` — push-уведомления
- `mail.js`, `email-utils.js` — почта и EML

## Маршрутизация запросов

URL = путь к объекту, первый query-параметр без значения — имя метода:
- `/BASE?info` → `item.info()`
- `/BASE?get_schema` → `item.get_schema()`
- `/BASE?save_file&filename=test.txt` → `item.save_file({filename: 'test.txt'})`

POST: `multipart/form-data` — поля/файлы; `application/json` и `text/*` — строка; остальное (`application/octet-stream`, video, office) — `Buffer`. Иначе `toString('utf-8')` портит OLE/zip (`doc`/`xls`/`xlsx`).

GET тела `$file` (без метода, `?load`, `?script`) — поток с диска (`download`), не `load()`. Сжатие быстрое (brotli/gzip level 4) и только до 256 КБ; крупнее отдаётся как есть. JS/CSS/WASM/SVG — `Cache-Control: must-revalidate, public, max-age=3600`. `load()` — чтение содержимого для кода. `~` merge нескольких JS — по-прежнему строка в памяти. `?download` — вложение, без кэша.

Разрешение метода: сначала метод класса FS, затем (legacy) `~/handlers/methods/`.