# sources/client/ — клиентские прокси-классы

Клиентская объектная модель. Классы повторяют серверные сущности, но вместо работы с диском обращаются к серверу через `WORK.fetch()`.

## Файлы

- `index.js` — сборка клиентского `CORE` и реэкспорт `$item` из `../core.js`
- `folder.js` — клиентский `$folder`: `url`, `fetch`, `get_item`, `save_file`, `load`, `save`, `delete`, `create`
- `storage.js` — клиентский `$storage`: import/save `data.js`, metadata, fields
- `file.js` — клиентский `$file`: загрузка/скачивание по HTTP
- `user.js` — клиентский `$user`
- `handler.js` — клиентская модель handler'а
- `field.js` — клиентская модель поля/описателя данных

## Принцип

Один контракт с двух сторон: серверный `$storage.logs()` читает `.logs` с диска; клиентский — это HTTP-запрос. Одно имя, разное поведение.