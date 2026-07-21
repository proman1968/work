# sources/host/ — серверный рантайм

Серверная инфраструктура: запуск HTTP/HTTPS, WebSocket, авторизация, merge class.js, host-хелперы. Эти файлы не являются частью объектной модели — они обеспечивают работу сервера и изолируют внешние интеграции (crypto/HTTP) от файлового дерева WORK.

## Файлы

- `config.js` — env-конфигурация: host, ports, TLS, dev mode
- `http-server.js` — запуск HTTP/HTTPS, разбор запроса, routing методов (`execItemMethod`), webhook ЮKassa
- `websocket.js` — WebSocket-события (`changed`, `chat.delta`, `chat.done`)
- `stun.js` — локальный STUN для WebRTC
- `auth-methods.js` — login/register/session (примешиваются в прототип `$server`)
- `babel-merge.js` — merge `class.js` по слоям наследования (Babel AST)
- `vapid.js`, `push.js` — push-уведомления
- `mail.js`, `email-utils.js` — почта и EML

## Host-хелперы (интеграции без FS-путей к WORK)

- `billing-store.js` — обёртка над `get_storage`/`save_file`: `loadWorkFile`/`saveWorkFile`/`listWorkFiles` + `requireWorkAdmin`/`newTxId`. Общий `$work`-helper для Billing, Licenses, Offerings.
- `licenses.js` — crypto: `generateKeyPair`, `signLicense`, `verifyLicense`, `buildLicense`, `isExpired`, `licenseKeys(WORK)` (один источник ключевой пары).
- `yookassa.js` — HTTP-клиент ЮKassa: `createPayment`, `getPayment`, `verifyWebhook` (HMAC, optional).
- `offering-paas.js` — хелперы PaaS: валидация, `defaultPlansDocument`, `safeParse`, `canManageOffering`.
- `stats-collector.js` — буфер запросов/AI/байтов, flush раз в 60с в `SYS/Billing.recordUsage` с `$context`.

## Маршрутизация запросов

URL = путь к объекту, первый query-параметр без значения — имя метода:
- `/base?info` → `item.info()`
- `/base?get_schema` → `item.get_schema()`
- `/base?save_file&filename=test.txt` → `item.save_file({filename: 'test.txt'})`

Разрешение метода: сначала метод класса FS, затем (legacy) `~/handlers/methods/`.

## Спецмаршруты

- `POST /api/billing/yookassa/webhook` — webhook ЮKassa → `SYS/Billing.creditWallet` (с `$context`).
