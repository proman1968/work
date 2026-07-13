# sources/host/ — серверный рантайм

Серверная инфраструктура: запуск HTTP/HTTPS, WebSocket, авторизация, merge data.js. Эти файлы не являются частью объектной модели — они обеспечивают работу сервера.

## Файлы

- `config.js` — env-конфигурация: host, ports, TLS, dev mode
- `security.js` — контроль доступа: `allowAccess`, `canSee`, `canWrite`, `METHOD_ACCESS`
- `http-server.js` — запуск HTTP/HTTPS, разбор запроса, routing методов (`execItemMethod`)
- `websocket.js` — WebSocket-события (`changed`, `chat.delta`, `chat.done`)
- `stun.js` — локальный STUN для WebRTC
- `auth-methods.js` — login/register/session (примешиваются в прототип `$server`)
- `babel-merge.js` — merge `data.js` по слоям наследования (Babel AST)
- `vapid.js`, `push.js` — push-уведомления
- `mail.js`, `email-utils.js` — почта и EML

## Маршрутизация запросов

URL = путь к объекту, первый query-параметр без значения — имя метода:
- `/base?info` → `item.info()`
- `/base?get_schema` → `item.get_schema()`
- `/base?save_file&filename=test.txt` → `item.save_file({filename: 'test.txt'})`

Разрешение метода: сначала метод класса FS, затем (legacy) `~/handlers/methods/`.