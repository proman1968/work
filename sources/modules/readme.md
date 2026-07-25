# sources/modules/ — технические модули платформы

Тяжёлые и внешние модули, не являющиеся ядром объектной модели и не являющиеся прикладной семантикой типов (`$ai`, PDCA и т.п.).

Прикладная модель файла `.ai` живёт во фрагментах типизатора `$ai` (в т.ч. `methods/prompt/$method/class.js`), не здесь. См. [`rules/rules.md`](/rules/rules.md/~/handlers/pages/form/) §1.11.

## Модули

- `ai-schema.js` — построение схемы методов элемента для ИИ-агента (`buildAiSchema`)
- `embeddings/` — embeddings/RAG (Xenova, kreuzberg)
- `tts/` — Piper (:8003, default local) и Qwen3-TTS (:8002); модели [`/MODELS/Local/Piper`](/MODELS/Local/Piper/~/handlers/pages/form/), [`/MODELS/Local/Qwen3-TTS`](/MODELS/Local/Qwen3-TTS/~/handlers/pages/form/)
- `call/` — WebRTC-звонки
- `user-profile/` — клиентский UI профиля пользователя

## ai-schema.js

Утилита `buildAiSchema(proto)` — парсит стандартный JSDoc (`@param` / `@returns`) из исходных файлов классов. Обходит всю цепочку прототипов. Результат кэшируется в `WeakMap`.

**Канон описаний methods для ИИ — обычный JSDoc** (IDE + `get_schema`). В схему — summary плюс `@param` и/или `@returns`. Ключи `params.x` сплющиваются в `x`. Голый `@param {object} [params]` без ключей в FC не отдаётся; у `type: object` всегда есть `properties` (GigaChat).

Критическая особенность: `Function.prototype.toString()` в V8 не сохраняет JSDoc-комментарии, поэтому парсинг идёт по исходному файлу через `constructor.sourceUrl`.
