# Qwen3.8 Flash Next 125b MLX

## Назначение

Класс модели ИИ у провайдера `/MODELS/BIS-Ollama`. Подключает remote-модель в WORK как точку выбора (`body.model`, prompt, чат).

## Устройство

- **path:** `/MODELS/BIS-Ollama/Qwen3.8 Flash Next 125b MLX`
- **type:** `$ai`
- **id:** `Qwen3.8 Flash Next 125b MLX`

- **model:** `qwen3.8-flash-next:125b-mlx` (тег API / remote)
- **icon:** `ai:qwen`
- **maxTokens:** `131072`
- **capabilities:** chat, stream, functions

Источник истины полей — `class.js` в meta этой точки (readme не дублирует реализацию, только контракт).

## Контракт

- Использовать как модель сессии / агента, указывая path этого класса.
- Не создавать второй дочерний класс у того же провайдера с тем же `model`.
- Смена remote-тега — правка `model` в class.js и обновление этого readme.
