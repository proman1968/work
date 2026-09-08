# Exaone3.5 7.8b

## Назначение

Класс модели ИИ у провайдера `/MODELS/BIS-Ollama`. Подключает remote-модель в WORK как точку выбора (`body.model`, prompt, чат).

## Устройство

- **path:** `/MODELS/BIS-Ollama/Exaone3.5 7.8b`
- **type:** `$ai`
- **id:** `Exaone3.5 7.8b`

- **model:** `exaone3.5:7.8b` (тег API / remote)
- **icon:** `ai:exaone`
- **maxTokens:** `131072`
- **capabilities:** chat, stream, functions

Источник истины полей — `class.js` в meta этой точки (readme не дублирует реализацию, только контракт).

## Контракт

- Использовать как модель сессии / агента, указывая path этого класса.
- Не создавать второй дочерний класс у того же провайдера с тем же `model`.
- Смена remote-тега — правка `model` в class.js и обновление этого readme.
