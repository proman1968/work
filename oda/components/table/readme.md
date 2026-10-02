# `oda-table`

## 1. Что это

Таблица: виртуализация строк, дерево строк, группировка, дерево колонок, фиксированные колонки, сортировка и фильтр, ширина колонок, контролы ячеек, мини-форма строки.

## 2. Зачем это нужно

Основа табличных представлений и `data-grid` объектов класса.

## 3. Как это работает

- Наследник `oda-structure`: карта `controls` выбирает контрол ячейки по полю ячейки. Поле ячейки = колонка ← строка (`row.$fields['*']`) ← ячейка (`row.$fields[колонка]`); `control` / `template` — явный тег. Без карты — текст.
- `editable` — правка ячеек (событие `cell-changed` `{row, column, value}`); строка с `readonly` не правится.
- Сортировка — щелчок по заголовку (несколько колонок) или `sortBy(column, dir)`; фильтр — `filter` (поиск по видимым колонкам) и фильтр колонки; ветки с совпадениями раскрываются. Исходные массивы не меняются.
- Ширина: перетаскивание разделителя (сохраняется), двойной щелчок по разделителю или `fitColumn(column)` — по содержимому, `autoFit` — для всех колонок без `width`.
- Дерево: `items` строки, колонка `treeMode`; отметка `allowCheck` (down / up / double — каскад) — `setChecked(row, state)`.
- Дерево колонок: `items` колонки; группировка — панель `showGroupPanel`.
- `allowRowPanel`: двойной щелчок / Enter открывает строку в боковой панели (`oda-form` по листовым колонкам).

### Контракт для ИИ-агентов

- Тег `oda-table`, импорт `/oda/components/table/table.js`.
- Данные: `dataSet` (массив строк; служебные `level`, `expanded`, `checked` таблица пишет в строки), `columns` `[{name, label, type, options, width, fix, treeMode, items, control}]` — варианты выбора в колонке задаются `options` (`items` колонки — дочерние колонки).
- Свойства: `controls`, `editable`, `filter`, `autoFit`, `allowRowPanel`, `showHeader`, `showFooter`, `showGroupPanel`, `allowSort`, `allowFocus`, `allowCheck`, `evenOdd`, `rowLines`, `colLines`, `focusedRow`.

## 4. Из чего это состоит

- `table.js` — `oda-table`
- `lib/body.js` — `oda-table-body`, `oda-table-row`, `oda-table-cell`
- `lib/header.js` — `oda-table-header`, `oda-table-header-cell`
- `lib/footer.js`, `lib/panel.js` — итоги, панель группировки
- `index.html` — демо

## 5. В каком это состоянии

✅ работает (демо, `tests/ui/oda-components.html`).
- 🔧 агрегаты подвала (`aggregate`) не считаются.
- 🔧 служебные поля пишутся в строки данных.

## 6. Дальнейшие планы

- Хранить состояние строк (раскрытие, отметка) вне данных.
- Агрегаты подвала и групп.
- Виртуализация колонок.
