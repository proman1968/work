# BIS-Ollama

Провайдер Ollama (`/MODELS/BIS-Ollama`, `$provider`). Не модель. Слой выше — [`/MODELS`](/MODELS/$ai/readme.md/~/handlers/pages/form/).

## Ходы

1. Дети = подключённые модели `$ai` (`ls` / `info deep=2`).
2. **remote** здесь — список на API по `baseUrl` (канал `$provider/$folder/$class/$ai`).
3. Недостающие = remote − дети → `create` `$ai` только под `/MODELS/BIS-Ollama`.

## Запреты

- remote / ask на `/MODELS`
- create моделей под корнем `/MODELS`

## Из чего состоит

- [`class.js`](/MODELS/BIS-Ollama/$provider/class.js/~/handlers/pages/form/) — провайдер
- [`$folder/$class/$ai/`](/MODELS/BIS-Ollama/$provider/$folder/$class/$ai/class.js/~/handlers/pages/form/) — канал/шаблон моделей
- дети — модели `$ai` (список — только ls/info)
