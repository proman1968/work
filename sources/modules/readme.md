# sources/modules/ — прикладные модули

Тяжёлые и внешние модули, не являющиеся ядром объектной модели.

## Модули

- `ai-schema.js` — построение схемы методов элемента для ИИ-агента (`buildAiSchema`)
- `embeddings/` — embeddings/RAG (Xenova, kreuzberg)
- `tts/` — Text-to-Speech (браузерный, GigaChat, Silero)
- `call/` — WebRTC-звонки
- `user-profile/` — клиентский UI профиля пользователя

## ai-schema.js

Утилита `buildAiSchema(proto)` — парсит JSDoc-теги `@ai` из исходных файлов классов. Обходит всю цепочку прототипов. Результат кэшируется в `WeakMap`.

Критическая особенность: `Function.prototype.toString()` в V8 не сохраняет JSDoc-комментарии, поэтому парсинг идёт по исходному файлу через `constructor.sourceUrl`.