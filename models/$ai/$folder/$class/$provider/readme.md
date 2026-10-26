# $provider — провайдер моделей ИИ

Тип канала/API под `/MODELS` (не конечная модель). Как `$account` в журнале: объявлен в meta каталога, узлы — дети `/MODELS`.

## Ходы

1. Создать провайдер: `create` под `/MODELS`, **type: `$provider`**, id = имя (BIS-Ollama, …).
2. Канал API (`baseUrl`, `protocol`, …) — в `$provider/class.js` и/или в `$provider/$folder/$class/$ai` (шаблон моделей).
3. Модели — дети с **type `$ai`**, `create` под провайдером.
4. **remote** / `list_remote` — только на узле `$provider`, не на `/MODELS` и не на модели.

## Из чего состоит

- [`class.js`](/MODELS/$ai/$folder/$class/$provider/class.js/~/handlers/pages/form/) — тип: METADATA канала, `list_remote`
- Узлы `/MODELS/<id>` — meta `$provider/`
- Шаблон моделей — `$provider/$folder/$class/$ai/`
