# `oda-markdown, oda-markdown-editor, oda-markdown-viewer`

## 1. Что это

Markdown: просмотр (markdown-wasm, MathJax, mermaid, подсветка, встраивание медиа), редактор SimpleMDE, связка редактор + просмотр.

## 2. Зачем это нужно

Документы и сообщения в markdown.

## 3. Как это работает

`oda-markdown-viewer.value` — исходник; ссылки — событие `md-link` (отменяемое).

### Контракт для ИИ-агентов

- Теги `oda-markdown` (`value`, `editMode`, `readOnly`, `url`), `oda-markdown-editor` (`value`), `oda-markdown-viewer` (`value`; события `md-link`, `loaded`).

## 4. Из чего это состоит

- `markdown.js`, `markdown-editor/`, `markdown-viewer/` (с `lib/` — сторонний код)
- `index.html`

## 5. В каком это состоянии

✅ работает; 🔧 тяжёлые библиотеки грузятся при импорте.

## 6. Дальнейшие планы

- По реестру `oda/components/readme.md`.
