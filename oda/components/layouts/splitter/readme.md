# `oda-splitter`

## 1. Что это

Разделитель: перетаскиванием меняет размер соседнего элемента (или двух).

## 2. Зачем это нужно

Боковые панели и разделённые области.

## 3. Как это работает

Режимы `left` / `right` / `top` / `bottom` (один сосед) или `vertical` / `horizontal` (оба); `percent` — доли в процентах.

### Контракт для ИИ-агентов

- Тег `oda-splitter`; свойства `left`, `right`, `top`, `bottom`, `vertical`, `horizontal`, `size`, `min`, `max`, `percent`, `reverse`, `width`, `height`; событие `resize`.

## 4. Из чего это состоит

- `splitter.js`
- `index.html`

## 5. В каком это состоянии

✅ работает.

## 6. Дальнейшие планы

- По реестру `oda/components/readme.md`.
