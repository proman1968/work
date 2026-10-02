# `oda-tree`

## 1. Что это

Дерево с ленивой загрузкой дочерних (`itemsSelector`) и колонками-ячейками.

## 2. Зачем это нужно

Навигационные деревья и выбор (`oda-icons-tree`, страницы классов).

## 3. Как это работает

Узел — `oda-tree-item`, шаблон узла — `nodeTemplate` (наследник подменяет своим, например `oda-tree-node`); колонки `columns` `{id, template}`.
Строка поиска — `allowSearch`, текст — `filter` (скрывает несовпавшие; совпавшие ветки показываются раскрытыми на время поиска).
Клавиатурная навигация — `up()`/`down()` через `nodeChildren`/`rootItems`/`nodeOf` (наследник переопределяет под свою модель).

### Контракт для ИИ-агентов

- Тег `oda-tree`; свойства `items`, `itemsSelector`, `nodeTemplate`, `itemTemplate`, `columns`, `allowFocus`, `focusedItem`, `checkMode`, `hideTops`, `hideRoots`, `filter`, `allowSearch`.
- Наследник `item-tree` (`~/lib//tree`): та же механика на `$item` (см. его readme).

## 4. Из чего это состоит

- `tree.js` — `oda-tree`, `oda-tree-header`, `oda-tree-header-cell`, `oda-tree-item`, `oda-tree-cell`
- `index.html`

## 5. В каком это состоянии

✅ работает у текущих потребителей.
- ⚠️ редакторы ячеек `tree-*-editor` удалены (заменены контролами `inputs/` в `oda-property-grid`).
- 🔧 колоночные возможности дублируют `oda-table`.

## 6. Дальнейшие планы

- Лёгкое дерево без колонок; колоночные потребители — на `oda-table`.
