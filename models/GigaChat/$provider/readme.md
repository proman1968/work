# GigaChat

Провайдер GigaChat (`/MODELS/GigaChat`, `$provider`). Модели — `GigaChat Light`, `GigaChat Pro` (наследуют настройки подключения из `$folder/$class/$ai/class.js`).

## Ключ доступа

Authorization key (из личного кабинета GigaChat API) **в коде и в git не хранится**. Порядок поиска:

1. Файл `/MODELS/GigaChat/$provider/#secret/gigachat.json` — `{ "token": "<Authorization key>" }`. Папки `#secret` в git не попадают (`.gitignore`).
2. Запасной вариант — переменная окружения `GIGACHAT_KEY` (сервер `.env` сам не читает: переменную нужно задать в окружении процесса).

Поле `token` модели можно переопределить: литерал, `env:ИМЯ` или `secret:ФАЙЛ` (см. `resolveKey` в `$ai/$folder/$class/$ai/class.js`). Если ключа нет — ошибка с подсказкой, куда его положить.

## Состояние

- Ключ перенесён из кода в `#secret` (hardening 0.2).
- Проверка TLS включена (hardening 0.4): серверы GigaChat подписаны корнем НУЦ Минцифры, которого нет в списке Node, поэтому к стандартным корням добавляется `#system/certs/russian_trusted_root_ca.pem` (публичный сертификат, SHA-256 `D2:6D:2D:02:…:CF:31`; действует до 2032-02). Реализация — `sources/host/tls-ca.js`, доступ из адаптера — `WORK.tls_agent(ai)`.

## TLS-настройки модели / провайдера

| Поле | Значение |
|---|---|
| `ca` | имя PEM-файла в `#system/certs/` (для `protocol: 'gigachat'` по умолчанию `russian_trusted_root_ca.pem`) |
| `tlsInsecure` | `true` — отключить проверку сертификата. Только отладка, в лог пишется предупреждение |
