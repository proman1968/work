# Tongyi-MAI/Z-Image-Turbo

## Назначение

Класс модели ИИ у провайдера `/MODELS/odant`. Подключает remote-модель в WORK как точку выбора (`body.model`, prompt, чат).

## Устройство

- **path:** `/MODELS/odant/Z-Image-Turbo`
- **type:** `$ai`
- **id:** `Z-Image-Turbo`
- **label:** Tongyi-MAI/Z-Image-Turbo
- **model:** `Tongyi-MAI/Z-Image-Turbo` (тег API / remote)
- **icon:** `carbon:image`

- **capabilities:** image

Источник истины полей — `class.js` в meta этой точки (readme не дублирует реализацию, только контракт).

## Контракт

- Использовать как модель сессии / агента, указывая path этого класса.
- Не создавать второй дочерний класс у того же провайдера с тем же `model`.
- Смена remote-тега — правка `model` в class.js и обновление этого readme.
