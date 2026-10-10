# `oda-icon`

## 1. Что это

Иконка: символ SVG-библиотеки (`lib:name`), изображение по URL или текст (`@:текст`); бейдж, подиконка, поворот.

## 2. Зачем это нужно

Все иконки интерфейса.

## 3. Как это работает

- Цепочка запасных вариантов `icon → iconsList → default`.
- Библиотеки — `/oda/tools/icons/lib/svg/<lib>.svg`.

### Контракт для ИИ-агентов

- Тег `oda-icon`; свойства `icon`, `default`, `iconSize`, `fill`, `stroke`, `iconColor` (фон), `rotate`, `blink`, `round`, `bubble`, `subIcon`, `colorMode`.

## 4. Из чего это состоит

- `icon.js`
- `index.html`

## 5. В каком это состоянии

✅ работает; растеризация для canvas перенесена в модуль звонка (`sources/modules/call`).

## 6. Дальнейшие планы

- Переименовать `iconColor` → `iconBackground`, `default` → `fallback` (с переводом потребителей).
