# Прогресс: item-tree

## Последние изменения
- [15:47] `hideReadme` заменён на `hideFiles`: при флаге скрываются все `$file`, не только `readme.md`. Причина: в меню handlers рядом с пунктами оставались `progress.md` и прочие файлы.
- [15:47] Фильтры `hideSystem` / `hideFiles` / `onlyClasses` сведены в `applyTreeFilters` — один путь для `getItems` и `oda-tree-node.items`.

## В работе
- —

## Ключевые решения
- Скрытие файлов не глобальное: explorer показывает файлы, меню передаёт `hide-files` само.
- Критерий — `instanceof CORE.$file`, не regex по имени: пункты меню (`$handler` / `$class` / `$folder`) остаются.
- Фильтр только в UI-дереве, не в серверном `folder.items`. Кнопка «?» читает полный `$item.items`.

## Блокеры / Открытые вопросы
- —
