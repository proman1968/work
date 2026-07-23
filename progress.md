# Прогресс: WORK — платформа управления деятельностью

## Последние изменения

- [18:25] GigaChat 422: при force — только `save_file` в functions; sanitize messages (сироты FC→prose); harness-схема вместо schema.

## В работе

- Покрытие директорий `readme.md` по стандарту `rules/`.

## Ключевые решения

- **GigaChat force** — `body.functions = [save_file]` only; иначе 422 `undefined functions in dialog history`.
- **create ≠ файл** — артефакт только через `save_file`.

## Блокеры / Открытые вопросы

- Добавлять ли `.progress.md/history/` в `.gitignore`?
