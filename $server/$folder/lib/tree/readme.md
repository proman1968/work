# item-tree — дерево элементов

## Что это

Рекурсивное дерево `$item` на базе `oda-tree-node` и `item-node`. Технически — UI-навигация по `items`; прикладное — обзор иерархии в explorer и в контекстном меню handlers.

## Зачем это нужно

Единый способ раскрывать папки и handlers без дублирования разметки в каждом экране. Категории (`allow-categories`), `hideTops` / `hideRoots` позволяют строить меню methods/pages поверх того же дерева.

## Как это работает

- Дети берутся через `itemsSelector` (по умолчанию `items`).
- `hideSystem` убирает `$…` типы.
- `hideReadme` (по умолчанию выкл.) скрывает `readme.md` из списка — включает только `item-menu` handlers; в explorer файлы `readme.md` видны.
- Узлы с собственным `readme.md` показывают «?» на `item-node` — только папки/$class под `/oda` и `/sources` (файлы и прочие пути без probe).

## Из чего это состоит

- [`tree.js`](/$server/$folder/lib/tree/tree.js/~/handlers/pages/form/) — `item-tree` / `oda-tree-node`: загрузка детей, опциональный `hideReadme`, expand/focus/check (навигация по иерархии)

## В каком это состоянии

- ✅ дерево, категории, hideTops/hideRoots
- ✅ `hideReadme` только по флагу (меню), не глобально
- ✅ совместимость с кнопкой справки на `item-node`

## Дальнейшие планы

- —
