# oda/components/structure — Структуры: формы

## 1. Что это

Представления по описаниям полей: общая модель `oda-structure` (`structure.js`), нормализация полей (`fields.js`), словарь и правило разрешения «тип → тег контрола» (`controls-map.js` / `controls.js`), форма и property-grid.

## 2. Зачем это нужно

Группирует компоненты одного назначения; демо категории — `index.html` (все демо рядом).

## 3. Как это работает

- Каждый компонент — папка `<имя>/<имя>.js` с `readme.md` и `index.html`.
- `controls-map.js` содержит чистый словарь `CONTROLS` и функцию `controlOf(map, field)` (без импортов контролов); `controls.js` подключает сами веб-компоненты и реэкспортирует `CONTROLS` и `controlOf`.

## 4. Из чего это состоит

- `structure.js` — базовый компонент `oda-structure`
- `fields.js` — каноническая нормализация дерева полей (`normalizeFields`, `canonicalType`)
- `controls-map.js` — словарь `CONTROLS` и функция разрешения `controlOf`
- `controls.js` — регистрация контролов ввода + реэкспорт `CONTROLS` и `controlOf`
- `form/` — `oda-form` — иерархическая форма
- `property-grid/` — `oda-property-grid` — инспектор свойств

## 5. В каком это состоянии

✅ работает.

## 6. Дальнейшие планы

- Развитие по реестру `oda/components/readme.md`.
