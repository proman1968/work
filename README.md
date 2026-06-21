# WORK — Extensible Fractal File System

Файло-ориентированная веб-платформа odant.org: структура папок = данные + API + UI.

## Быстрый старт

```bash
npm install
npm start
```

Открыть: http://localhost:8001/

## Переменные окружения

Скопируйте `.env.example` в `.env` и настройте при необходимости:

| Переменная | По умолчанию | Описание |
|------------|--------------|----------|
| `WORK_DEV` | `false` | Режим разработки (логи, без утечки секретов в HTTP) |
| `WORK_HOST` | `localhost` | HTTP-хост |
| `WORK_PORT` | `8001` | HTTP-порт |
| `WORK_TLS_CERT` | — | Путь к TLS-сертификату |
| `WORK_TLS_KEY` | — | Путь к TLS-ключу |

## Структура

```
sources/
  work.js          — bootstrap (запуск сервера)
  server.js        — FS-модель ($item, $folder, $storage, RAG)
  server/            — HTTP, auth, push, merge, handlers
    work-server.js   — класс WorkServer (корень WORK)
    request-handler.js
    exec-item-method.js
    auth-methods.js
    ...
oda/         — UI-фреймворк (Web Components)
$server/     — системные шаблоны типов
root/        — данные приложения
users/       — профили пользователей
services/    — внешние AI-сервисы
```

## API

URL = путь в файловой системе. Первый query-параметр без значения — имя метода:

```
/root/direction/group?info
```

## Тесты

```bash
npm test
```
