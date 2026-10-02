# `oda-code-editor`

## 1. Что это

Редактор кода на Ace: темы, режимы, форматирование, поиск, точки останова.

## 2. Зачем это нужно

Правка кода и данных (`oda-code-input`, jupyter).

## 3. Как это работает

Значение — `value` (событие `change`), режим — `mode`, только чтение — `readOnly`.

### Контракт для ИИ-агентов

- Тег `oda-code-editor`; свойства `value`, `mode`, `theme`, `readOnly`, `wrap`, `minLines`, `maxLines`, `showGutter`; события `change`, `change-cursor`, `loaded`.

## 4. Из чего это состоит

- `code-editor.js`
- `src/` — Ace (сторонний код)
- `index.html`

## 5. В каком это состоянии

✅ работает.

## 6. Дальнейшие планы

- По реестру `oda/components/readme.md`.
