# sources/server/ — серверные классы FS

Серверная объектная модель. Реальная работа с файловой системой: чтение, запись, наследование, логи, RAG.

## Файлы

- `index.js` — сборка `CORE` и registry `FS`: `$folder`, `$class`, `$handler`, `$user`, `$file`
- `folder.js` — `$folder`: дерево элементов, `children`, `get_item`, `tilde`, `info`, `save_file`, `find_text`, `get_schema`
- `class.js` — `$class`: `class.js`, merge/diff, logs, secrets, metadata, `task_reply`
- `file.js` — `$file`: load/save, history, RAG, `edit_file`, триггеры `on_save`
- `handler.js` — `$handler extends $class`: исполняемый элемент (execute в class.js)
- `user.js` — `$user`: пользовательская storage-сущность, online-статус
- `server.js` — `$server`: корневой серверный `$class`, HTTP-сессии, merge `class.js`

## Ключевые механизмы

- **Наследование** — `~` (tilde) и merge `class.js` по слоям
- **`get_schema()`** — схема методов для ИИ-агента (через `buildAiSchema`, канон = стандартный JSDoc `@param`/`@returns`)
- **`static sourceUrl = import.meta.url`** — для парсинга JSDoc из исходника
- **`save_file` → `save_to_history`** — return = history path снимка (карточка file в task.ai показывает его)
