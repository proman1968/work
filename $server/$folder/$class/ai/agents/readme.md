# agents — пакет исполнения

## Что это

Каталог агентов движка (`_aiPackage`). `loadAgent` берёт `{id}.js` **отсюда**, не из meta пира и не из `~/ai` чужого класса.

## Зачем

Один runtime на всех, кто ходит этим методом `prompt`. Копия `ai/agents` в USER / локальном `$class` без смены `loadAgent` **не исполняется**.

## Как

Файл = агент. Имя файла = id в pipe (`web.js` → `web`). Правка поведения хода — write этого файла. Новый ход — новый файл здесь, не invent в USER.

Инвентарь мира (модели у провайдера, счета) — `work.create` у родителя, не файл в этом каталоге. Действие в журнале места (встреча) — `work.typed`: тип `$file` (`when` + `METADATA`), не create.

## Состав

`explore` `work` `check` `web` `site` `logs` `image` `freeze` `review` `html` `planning` `answer` `question` `form` `report`
