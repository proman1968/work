# Licenses — лицензии организации

## Что это

Системный класс `$licenses` в PROTECTED-зоне `/SYS/Licenses`: self-signed лицензии (`.lic`) для субъектов услуг. Технически — `$licenses/$folder/$class/$licenses` с методами; прикладное назначение — выдавать и проверять права на использование услуг (PaaS и др.), подписанные собственным ключом организации.

## Зачем это нужно

Услуга, выданная клиенту, должна подтверждаться криптографически, а не просто записью в БД. Лицензия — это подписанный файл, который можно проверить оффлайн и который нельзя подделать без приватного ключа. `/SYS/Licenses`集中ует выпуск/проверку/продление в одном месте, а ключи лежат в `#system` вне файлового дерева. Это даёт доверие к правам клиентов без внешнего сервиса лицензирования.

## Как это работает

- **Ключевая пара** — `licenseKeys(WORK)` в [`sources/host/licenses.js`](/sources/host/licenses.js/~/handlers/pages/form/): читает `#system/licenses.json`, при отсутствии генерирует RSA-2048 и сохраняет. Один источник для issue/getActive/renew.
- **Выдача:** `issue` (system only) — `buildLicense` (header + human + terms + подпись RSA-SHA256) → сохранение `<subject>.lic` в ADMIN `$work`.
- **Проверка:** `verify` — проверка подписи по публичному ключу + `trustAnchors` (внешние якоря доверия), `isExpired` по `expiresAt`.
- **Продление:** `renew` (system only) — сдвигает `expiresAt`, переподписывает.
- **Boot-check:** `sources/work.js` при старте вызывает `getActive` — логирует количество активных лицензий.
- **Лимиты:** `checkLimit` — мягкая проверка `terms.limits[metric]` (нет лицензии → allowed; есть → `value <= limit`).

## Из чего это состоит

- [`$licenses/class.js`](/SYS/Licenses/$licenses/class.js/~/handlers/pages/form/) — item: label «Лицензии», icon certificate
- [`$licenses/$folder/$class/$licenses/class.js`](/SYS/Licenses/$licenses/$folder/$class/$licenses/class.js/~/handlers/pages/form/) — distributed тип
- **Методы** (`$licenses/$folder/$class/$licenses/methods/<name>/$method/class.js`):
  - `issue` — создание `.lic` (system only)
  - `verify` — проверка подписи и срока (root ADMIN)
  - `renew` — продление срока (system only)
  - `getActive` — список активных лицензий (root ADMIN; boot-check в `work.js`)
  - `checkLimit` — мягкая проверка лимита по метрике (root ADMIN)
- Данные: `<subject>.lic` в ADMIN `$work`; ключи в `#system/licenses.json`

## В каком это состоянии

- ✅ self-signed лицензии (RSA-SHA256), issue/verify/renew/getActive/checkLimit
- ✅ `licenseKeys` вынесен в `licenses.js` (один источник)
- ✅ boot-check в `work.js`
- 🔧 `checkLimit` без активных callers — ждёт подключения в Offerings runtime
- 🧪 гибридный режим (внешний подписчик) — задел через `trustAnchors`, не реализован

## Дальнейшие планы

- Подключить `checkLimit` в runtime Offerings (проверка перед операцией).
- Гибридный режим (вариант D): внешний подписчик + self-sign через `trustAnchors`.
- UI просмотра лицензий (аналог billing dashboard).
