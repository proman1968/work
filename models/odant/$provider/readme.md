# odant

Провайдер odant (`/MODELS/odant`, `$provider`). Не модель. Слой выше — [`/MODELS`](/MODELS/$ai/readme.md/~/handlers/pages/form/).

## Ходы

1. Дети = подключённые модели `$ai` (`ls` / `info deep=2`).
2. **remote** здесь — список на API по `baseUrl` (канал `$provider/$folder/$class/$ai`).
3. Недостающие = remote − дети → `create` `$ai` только под `/MODELS/odant` (не `write` файла).
4. `model` в class.js = id с remote; id папки — имя узла. Один `model` — один ребёнок.

## Запреты

- remote / ask на `/MODELS`
- create моделей под корнем `/MODELS`

## Из чего состоит

- [`class.js`](/MODELS/odant/$provider/class.js/~/handlers/pages/form/) — провайдер
- [`$folder/$class/$ai/`](/MODELS/odant/$provider/$folder/$class/$ai/class.js/~/handlers/pages/form/) — канал/шаблон моделей
- дети — модели `$ai` (список — только ls/info)
