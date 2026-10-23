# План доработок и устранения замечаний аудита (TODO)

Документ сформирован по результатам сквозного аудита кодовой базы платформы **WORK / ODANT** (октябрь 2026 г.).

---

## Блок P0 — Критичные исправления безопасности и целостности данных

- [x] **P0.1. Вынос зашитых учётных данных TURN и чистота сканера секретов**
  - Убрать открытые учётные данные (`username: 'odant', credential: 'lkhjasdf8967'`) из клиентского кода `sources/modules/call/call.js:818-820` (брать конфигурацию ICE/TURN из настроек или переопределяемого параметра без зашитого пароля в клиентском бандле).
  - В `docs/WORK-presentation.html` заменить длинный base64-блок логотипа на векторный SVG и пересобрать `docs/WORK-presentation.pdf`, чтобы `npm run check:secrets` проходил с `0 находок`.

- [x] **P0.2. Защита от обхода пути в `_readById` (Windows `\` и `..`) и валидация `push.js`**
  - В `sources/server/class.js:1138-1146` (`_readById`) нормализовать разделители `/` и `\`, строго проверять формат `stem` регулярным выражением `/^\d+\.[\p{L}\p{N}_.-]+$/u` и удостоверяться через `assertInside`, что путь находится внутри `DATA/`.
  - В `sources/server/server.js:169` и `sources/host/push.js:5` проверять `uid` получателя (запрет `.` и `..`).

- [x] **P0.3. Безопасный вызов `npm` без `shell: true` в `package-install.js`**
  - В `sources/host/package-install.js:15-19` убрать `shell: true` (на Windows вызывать `process.execPath` + `npm-cli.js` без интерпретации `<`, `>`, `|` оболочкой) и ужесточить проверку имени пакета в `sources/server/server.js:138` (запретить `<` и `>`).

- [x] **P0.4. Изоляция задач по владельцу в A2A и авторитетный `readOnly` в мосте ПК**
  - В `sources/modules/a2a/server.js:263-278`: запретить перезапись чужой задачи по клиентскому `params.id` (`existing && existing.uid !== auth.uid`), а при вытеснении старой задачи пользователя по лимиту `MAX_TASKS_PER_USER` вызывать `old.controller?.abort()`.
  - В `sources/modules/bridge/hub.js:174-196`: сохранять серверное состояние `readOnly` (`serverReadOnly`), чтобы переподключение процесса моста без флага `--readonly` не сбрасывало включённый пользователем через `desktop_mode` режим «только просмотр».

- [x] **P0.5. Очистка ссылок ленты (`REFS`) и обязательная проверка `canSee` в RAG**
  - В `sources/modules/rag/search.js:149`: проверять `REFS.visible` и физическое существование файла для `doc.feed` при финальной проверке выдачи в RAG.
  - В `sources/server/file.js` (при удалении файла): вызывать `REFS.removeTarget(this.path)` для очистки неактуальных разрешений ленты.

- [x] **P0.6. Сохранность истории файлов, `get_write_stream` и защита JSON-индексов от обнуления**
  - В `sources/server/folder.js:1684-1715`: убрать удаление файла (`fs.rmSync(dir)`) в `get_write_stream`, если поток не открывался; в `close_write_stream` ничего не делать, если активного потока нет.
  - В `sources/server/class.js:168-190` (`_lockedJson`) и `1076-1085` (`overlay_read`): перехватывать только `ENOENT` как пустой объект `{}`, а при повреждённом JSON пробрасывать ошибку вместо перезаписи файла пустым объектом; запись вести атомарно через `.tmp` + `rename`.

---

## Блок P1 — Стабилизация учётного ядра, хранения и агентской ИИ-системы

- [x] **P1.1. Блокировки (mutex) на изменение объектов и проведение операций (`post`/`unpost`)**
  - В `sources/server/class.js` сериализовать `create_object`, `update_object` и `delete_object` по ключу класса/объекта (`_withDataLock`), чтобы параллельные вызовы не теряли правки и не создавали дубликаты `unique`.
  - В `DATA/OPERATIONS/$operation/$folder/$class/$operation/class.js`: сериализовать `post` и `unpost` по `id` операции (`_withOpLock`), исключив двойное проведение при параллельных запросах.

- [x] **P1.2. Часовые пояса и полнота выборки в журнале проводок (`DATA/REGISTER`)**
  - В `DATA/REGISTER/$register/$folder/$class/$register/class.js:151-160`: заменить `toISOString().slice(0, 10)` (UTC) в `_day` на локальное форматирование даты (`toISOTimezoneString`, согласованное с `_dataDay` в `class.js`).
  - В `DATA/REGISTER/.../class.js:68, 86`: поднять лимит выборки проводок для журнала до 5000.

- [x] **P1.3. Стабильность префикса prompt-кэша в цикле агента (`loop.js`)**
  - В `sources/modules/agent/loop.js:716-755`: сделать микросжатие старых результатов инструментов (`OLD_RESULT_MAX`) персистентным (сохранять флаг `t.clipped = true` на элементах за пределами окна), чтобы при добавлении новых ходов старый префикс сообщений не менялся на каждом шаге и не сбрасывал кэш провайдера (OpenAI / Anthropic / DeepSeek).

- [x] **P1.4. Исправление SSE-ответов и изоляции сессий в Remote MCP (`SERVICES/$service`)**
  - В `SERVICES/$service/class.js:94, 170, 224-242`: включить `uid` пользователя в ключ `SESSIONS` remote MCP, а при разборе SSE пропускать JSON-RPC уведомления (сообщения без `id`) и возвращать только ответ с `msg.id === reqId`.

- [x] **P1.5. Детерминированная сортировка каталога навыков (>60) и подсчёт активных дочерних задач**
  - В `sources/modules/agent/tools/meta.js:550-552` (`listing`): выполнять `.sort(...)` **до** `.slice(0, max)`, чтобы первые 60 навыков не зависели от порядка обхода файловой системы.
  - В `sources/modules/agent/tools/meta.js:16-34` (`countChildTasks`): не учитывать принудительно остановленные (`status === 'stopped'`) задачи при проверке потолка `MAX_CHILD_TASKS`.

- [x] **P1.6. Фильтрация FTS5 по доступным кандидатам в RAG и защита транспорта моделей**
  - В `sources/modules/rag/search.js:109` и `store.js:260`: передавать множество допустимых `byHash` в `store.ftsSearch`, расширяя окно сканирования до фильтрации, чтобы глобальный лимит не вытеснял релевантные документы пользователя.
  - В `MODELS/$ai/$folder/$class/$ai/class.js:490-500`: сохранять базовый путь (`pathname`) `baseUrl` в `speechOrigin`.
  - В `sources/modules/sandbox/manager.js:229`: явно указывать `CapAdd: ['NET_ADMIN', 'NET_RAW']` для контейнера-хелпера сети.

---

## Блок P2 — Продуктовая и архитектурная дорожная карта (следующие этапы)

- [ ] **P2.1. Перевод индексов `$class` (`turnover`, `state`, `table`, `lookup`) на `node:sqlite`**
- [ ] **P2.2. Декомпозиция монолита `sources/server/class.js` на модули (`data`, `index`, `feed`, `security`)**
- [ ] **P2.3. Полное монтирование удалённых точек федерации узлов (`sources/modules/nodes`)**
- [ ] **P2.4. Коммерческий контур: платёжный шлюз (ЮKassa), рублёвый баланс компании, Helm-чарт PaaS в `SERVICES/ArgoCD/PaaS` и витрина маркетплейса плагинов**
