# oda/tools/icons — иконки

## 1. Что это

SVG-библиотеки иконок и браузер иконок.

## 2. Зачем это нужно

Источник иконок `oda-icon` (`lib:name`) и выбор иконки (`oda-icon-picker-input`).

## 3. Как это работает

`lib/svg/<lib>.svg` — символы; `lib-index.js` — список библиотек `ICON_LIBS` и индекс символов (`loadLibIndex`).

## 4. Из чего это состоит

- `lib/` — ассеты
- `lib-index.js` — индекс
- `icons-tree/` — `oda-icons-tree` (дерево библиотек с поиском)
- `icons-set/` — `oda-icons-set` (сетка библиотеки)
- `icons-test/` — `oda-icons-test` (браузер)
- `index.html` — браузер иконок

## 5. В каком это состоянии

✅ работает, без связи с WORK.

## 6. Дальнейшие планы

- Перенести ассеты к `components/icon`.
