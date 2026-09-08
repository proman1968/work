# Llama3.2 3b

## Назначение

Класс модели ИИ у провайдера `/MODELS/BIS-Ollama`. Подключает remote-модель в WORK как точку выбора (`body.model`, prompt, чат).

## Устройство

- **path:** `/MODELS/BIS-Ollama/Llama3.2 3b`
- **type:** `$ai`
- **id:** `Llama3.2 3b`

- **model:** `llama3.2:3b` (тег API / remote)
- **icon:** `ai:llama3`
- **maxTokens:** `131072`
- **capabilities:** chat, stream

Источник истины полей — `class.js` в meta этой точки (readme не дублирует реализацию, только контракт).

## Контракт

- Использовать как модель сессии / агента, указывая path этого класса.
- Не создавать второй дочерний класс у того же провайдера с тем же `model`.
- Смена remote-тега — правка `model` в class.js и обновление этого readme.
