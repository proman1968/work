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
- `icon` в `class.js` модели (`$ai`): иконку наследует от провайдера; различие моделей — только `label`/`model`

## Секреты

- `apiKey` читается из обоих мест: поле `class.js` (dev/legacy) и `secret:ФАЙЛ` (штатно). Ридер обязан поддерживать оба источника, приоритет — за файлом. Новым моделям ключ в `class.js` не писать.

## Из чего состоит

- [`$ai/class.js`](/MODELS/$ai/class.js/~/handlers/pages/form/) — тип корня-каталога
- [`$folder/$class/$provider/`](/MODELS/$ai/$folder/$class/$provider/readme.md/~/handlers/pages/form/) — тип провайдера (`list_remote`)
- [`$folder/$class/$ai/`](/MODELS/$ai/$folder/$class/$ai/class.js/~/handlers/pages/form/) — прототип моделей (`streamChat`, `generateImage`)
- дети `/MODELS` — `$provider`; их дети — `$ai` (инвентарь — только ls/info)


## Протокол `anthropic` — нативный Messages API

`protocol: 'anthropic'` — родной формат Claude (`POST {baseUrl}/v1/messages`, заголовки `x-api-key` + `anthropic-version`), а не OpenAI-совместимый чат. `baseUrl` — хост (`https://api.anthropic.com`), `…/v1` или `…/v1/messages`; устаревший `…/chat/completions` заменяется на `…/messages`. Для OpenAI-совместимых шлюзов к Claude используйте `protocol: 'openai'`.

Что делает адаптер (чистые функции в `class.js`, тесты — `tests/anthropic.test.js`):
- сообщения → блоки: `system`, `tool_use`/`tool_result` (результаты подряд — одним сообщением, первыми), картинки (base64 и URL), соседние сообщения одной роли склеиваются;
- кэш промпта (`cache_control`): последний инструмент, последний блок `system` (стабильная часть), последний блок истории **до** изменчивого служебного сообщения среды (оно меняется каждый ход — кэшировать его бессмысленно); всего 3 точки из 4 допустимых. Отключается `promptCache: false` у модели;
- `effort` (`low|medium|high|xhigh|max`) → `thinking.budget_tokens` (2048 / 8192 / 16384 / 32768 / 49152; не больше `max_tokens − 1024`, минимум 1024; с thinking `temperature` не передаётся). Нужна capability `effort`. Блоки размышлений с подписью цикл агента хранит в ленте (`thinkingBlocks`) и возвращает в следующем запросе — без этого цепочка вызовов инструментов при включённом thinking отклоняется API;
- `max_tokens` обязателен: берётся `maxOutput` запроса, затем `maxOutput` модели, иначе 8192;
- в `usage`: `prompt_tokens` = `input + cache_read + cache_creation` (полный размер запроса), `cached_tokens`, `cache_creation_tokens`;
- `anthropicBeta` у модели — значение заголовка `anthropic-beta`.