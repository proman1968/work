# x/z-image-turbo:bf16

## Назначение

Класс модели ИИ у провайдера `/MODELS/BIS-Ollama`. Подключает remote-модель в WORK как точку выбора (`body.model`, prompt, чат).

## Устройство

- **path:** `/MODELS/BIS-Ollama/z-image-turbo bf16`
- **type:** `$ai`
- **id:** `z-image-turbo bf16`
- **label:** x/z-image-turbo:bf16
- **model:** `x/z-image-turbo:bf16` (тег API / remote)
- **icon:** `carbon:image`

- **capabilities:** image

Источник истины полей — `class.js` в meta этой точки (readme не дублирует реализацию, только контракт).

## Контракт

- Использовать как модель сессии / агента, указывая path этого класса.
- Не создавать второй дочерний класс у того же провайдера с тем же `model`.
- Смена remote-тега — правка `model` в class.js и обновление этого readme.
