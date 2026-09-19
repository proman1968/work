# agents — пакет исполнения

## Что это

Каталог агентов движка (`_aiPackage`). `loadAgent` берёт `{id}.js` **отсюда**, не из meta пира и не из `~/ai` чужого класса.

## Зачем

Один runtime на всех, кто ходит этим методом `prompt`. Копия `ai/agents` в USER / локальном `$class` без смены `loadAgent` **не исполняется**.

## Как

Файл = агент. Имя файла = id в pipe (`web.js` → `web`). Правка поведения хода — write этого файла. Новый ход — новый файл здесь, не invent в USER. Вызов субагента — `nested` + `callAgent(id, brief)` у движка, не меню `$task` и не домен в system.

Инвентарь мира — `work.create` у родителя (закон — readme того родителя). Файл типа — `work.typed` (`when` + `METADATA`). `write` — только путь `/…`.

Агент знает ход (read/write/create/ls), не прикладной каталог. Домен — в readme места.

## Состав

`explore` `work` `check` `web` `site` `logs` `image` `freeze` `review` `html` `planning` `answer` `question` `form` `report`
