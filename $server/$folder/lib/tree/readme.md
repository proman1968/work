# item-tree — дерево элементов

## Что это

Рекурсивное дерево `$item` на базе `oda-tree-node` и `item-node`. Технически — UI-навигация по `items`; прикладное — обзор иерархии в explorer и в контекстном меню handlers.

## Зачем это нужно

Единый способ раскрывать папки и handlers без дублирования разметки в каждом экране. Категории (`allow-categories`), `hideTops` / `hideRoots` позволяют строить меню methods/pages поверх того же дерева.

## Как это работает

- Дети берутся через `itemsSelector` (по умолчанию `items`).
- `hideSystem` убирает `$…` типы.
- `hideFiles` (по умолчанию выкл.) скрывает все `$file` из списка — включает только `item-menu` handlers; в explorer файлы видны.
- Фильтры дерева (`hideSystem` / `hideFiles` / `onlyClasses`) сводятся в `applyTreeFilters`: `getItems` и `oda-tree-node.items` используют одну функцию.
- Узлы с собственным `readme.md` показывают «?» на `item-node`. Дерево может скрыть файлы из списка (`hideFiles`) — «?» берётся из полного `$item.items`.

## Из чего это состоит

- [`tree.js`](/$server/$folder/lib/tree/tree.js/~/handlers/pages/form/) — `item-tree` / `oda-tree-node`: загрузка детей, опциональный `hideFiles`, expand/focus/check (навигация по иерархии)

## В каком это состоянии

- ✅ дерево, категории, hideTops/hideRoots
- ✅ `hideFiles` только по флагу (меню), не глобально
- ✅ совместимость с кнопкой справки на `item-node`

## Дальнейшие планы

- —
