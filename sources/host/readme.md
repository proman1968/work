# sources/host/ — серверный рантайм

Серверная инфраструктура: запуск HTTP/HTTPS, WebSocket, авторизация, merge class.js. Эти файлы не являются частью объектной модели — они обеспечивают работу сервера.

## Файлы

- `config.js` — env-конфигурация: host, ports, TLS, dev mode, лимиты тела (`MAX_BODY_BYTES`, `MAX_UPLOAD_BYTES`), `PUBLIC_ORIGIN` (адрес в сети WORK)
- `http-server.js` — запуск HTTP/HTTPS, разбор запроса, вызов методов через шлюз доступа (`execItemMethod` → `server/access/gateway.js`)
- `websocket.js` — WebSocket-события (`changed`, `chat.delta`, `chat.done`); подписка только на видимые пути
- `index-db.js` — общая локальная БД индексов (`.index/work.db`, node:sqlite): индекс лент, RAG
- `net-guard.js` — исходящие запросы по пользовательским URL: только публичные адреса, закреплённый IP, лимиты
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

Разрешение метода — только через шлюз (`server/access/gateway.js`): методы ядра из реестра `MEMBERS` с уровнем (`public`/`user`/`read`/`call`/`write`/`admin`), геттеры ядра — чтение, методы `class.js`/`$method` — уровень из `ACCESS` class.js (по умолчанию `call`). Сеттеры, `_…`/`#…` и служебные члены недоступны. Шаги пути `/@свойство` проверяются тем же правилом. Списки в ответе фильтруются по правам.

## Безопасность транспорта

- **Сессии**: ssid — 192 бита `crypto.randomBytes`; неизвестный ssid из cookie не принимается (новая сессия); при входе ssid выдаётся заново (`$server.signIn`); простой > 14 дней — удаление. Cookie `HttpOnly; SameSite=Lax; Max-Age=30д` (+`Secure` по TLS). Субъект сессии — `session.principal` (`{kind: 'user'|'node', id, actor?}`), задаётся только после проверки подписи.
- **CSRF**: уровни `call`/`write`/`admin` требуют заголовок клиента `X-WORK-WSID` (или same-origin по `Sec-Fetch-Site`) и отвергают чужой `Origin`. CORS не разрешён (кроме `/.well-known/work-node`), предзапросы `OPTIONS` получают пустой ответ.
- **Пользовательское содержимое**: html/svg/xml/js из зон и кабинетов — `Content-Security-Policy: sandbox`; везде `X-Content-Type-Options: nosniff`.
- **Range** — с той же проверкой доступа, что `download`.
- **DEV** (`WORK_DEV`) — только для запросов с localhost. Источник режима — переменная окружения (`config.DEV_MODE` — запасной, когда её нет); в `config.json` режим не пишется. Кнопка «переключить в обычный» на плашке отладки (`page.html`) видна только ADMIN корня и зовёт `restart_normal`: отсоединённый помощник ждёт выхода старого процесса и стартует `node run.mjs` с `WORK_DEV=false` (лог — `work-restart.log`). Под менеджером процессов, перезапускающим сервер самим, режим меняется в его настройках.
- **Вход**: `user_login_start` не меняет личность сессии (ожидание привязано к uid и сроку); `user_register_*`: uid = SHA-256(email)[0..16] (код уходит владельцу адреса), код 6 цифр, 5 попыток, лимит отправок.
- **Узлы сети WORK**: запрос с `Work-Signature` — подпись узла из `/NODES` (см. `modules/nodes/readme.md`), эфемерная сессия без cookie.
- Журнал безопасности — `.index/audit/YYYY-MM-DD.jsonl`, чтение — `WORK.security_log({day})` (ADMIN).