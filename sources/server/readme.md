# sources/server/ — серверные классы FS

Серверная объектная модель. Реальная работа с файловой системой: чтение, запись, наследование, логи, RAG.

## Файлы

- `index.js` — сборка `CORE` и registry `FS`: `$folder`, `$storage`, `$handler`, `$user`, `$file`
- `folder.js` — `$folder`: дерево элементов, `children`, `get_item`, `tilde`, `info`, `save_file`, `find_text`, `get_schema`
- `storage.js` — `$storage`: `data.js`, merge/diff, logs, secrets, metadata, `task_reply`
- `file.js` — `$file`: load/save, history, RAG, `edit_file`, триггеры `on_save`
- `handler.js` — `$handler extends $storage`: исполняемый элемент (execute в data.js)
- `user.js` — `$user`: пользовательская storage-сущность, online-статус
- `server.js` — `$server`: корневой серверный `$storage`, HTTP-сессии, merge `data.js`

## Ключевые механизмы

- **Наследование** — `~` (tilde) и merge `data.js` по слоям
- **`get_schema()`** — схема методов для ИИ-агента (через `buildAiSchema`)
- **`TOOL_DESCRIPTIONS`** — статический словарь описаний методов
- **`static sourceUrl = import.meta.url`** — для парсинга JSDoc `@ai` тегов