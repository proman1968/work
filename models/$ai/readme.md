# MODELS

Каталог ИИ (`$ai`). **Два слоя:** дети = **`$provider`**; внуки = **`$ai`** (модели).

## Ходы

1. `ls` / `info({ deep: 2 })` на `/MODELS` — провайдеры и модели.
2. Задача про провайдера (bis-ollama, odant, …) → путь `/MODELS/<Провайдер>` (`$provider`).
3. **remote** / **ask** (API) — только на `$provider` (есть `list_remote`), не на `/MODELS`.
4. **Недостающие** = remote − дети провайдера → `create` `$ai` **под провайдером**, не `write` файла.
5. `class.js` модели — с прототипа соседа / `$folder/$class/$ai`. Поле `model` = тег API (может содержать `:` и `/`). id папки — безопасное имя; тег не терять: он в `model`, не в имени папки.
6. Один тег `model` — один ребёнок у провайдера.

## Запреты

- remote / ask на `/MODELS`
- считать список `$provider` списком моделей
- выдумывать модели без remote/ls
- `write` JSON вместо `create` `$ai`

## Из чего состоит

- [`$ai/class.js`](/MODELS/$ai/class.js/~/handlers/pages/form/) — тип корня-каталога
- [`$folder/$class/$provider/`](/MODELS/$ai/$folder/$class/$provider/readme.md/~/handlers/pages/form/) — тип провайдера (`list_remote`)
- [`$folder/$class/$ai/`](/MODELS/$ai/$folder/$class/$ai/class.js/~/handlers/pages/form/) — прототип моделей (`streamChat`, `generateImage`)
- дети `/MODELS` — `$provider`; их дети — `$ai` (инвентарь — только ls/info)
