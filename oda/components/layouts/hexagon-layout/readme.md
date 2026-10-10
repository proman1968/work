# `oda-hexagon-layout`

## 1. Что это

Сетка шестиугольных ярлыков с перетаскиванием («рабочий стол»).

## 2. Зачем это нужно

Главная страница explorer (`item-hexagon-layout`).

## 3. Как это работает

Ячейки `{x, y, label, title, background}`; строка 0 — верхняя панель.

### Контракт для ИИ-агентов

- Тег `oda-hexagon-layout` (обычно `extends`); свойства `items`, `tops`, `iconSize`, `background`.

## 4. Из чего это состоит

- `hexagon-layout.js` — `oda-hexagon-layout`, `oda-hexagon-item`
- `index.html`

## 5. В каком это состоянии

✅ работает в explorer; 🔧 `_onHexTap` — заглушка.

## 6. Дальнейшие планы

- По реестру `oda/components/readme.md`.
