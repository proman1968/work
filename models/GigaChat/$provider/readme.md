# GigaChat

Провайдер GigaChat (`/MODELS/GigaChat`, `$provider`). Модели — `GigaChat Light`, `GigaChat Pro` (наследуют настройки подключения из `$folder/$class/$ai/class.js`).

## Ключ доступа

Authorization key (из личного кабинета GigaChat API) **в коде и в git не хранится**. Порядок поиска:

1. Файл `/MODELS/GigaChat/$provider/#secret/gigachat.json` — `{ "token": "<Authorization key>" }`. Папки `#secret` в git не попадают (`.gitignore`).
2. Запасной вариант — переменная окружения `GIGACHAT_KEY` (сервер `.env` сам не читает: переменную нужно задать в окружении процесса).

Поле `token` модели можно переопределить: литерал, `env:ИМЯ` или `secret:ФАЙЛ` (см. `resolveKey` в `$ai/$folder/$class/$ai/class.js`). Если ключа нет — ошибка с подсказкой, куда его положить.

## Состояние

- Ключ перенесён из кода в `#secret` (hardening 0.2).
- Проверка TLS для GigaChat пока отключена (`rejectUnauthorized:false`), включается в пункте 0.4 с корневым сертификатом НУЦ Минцифры.
