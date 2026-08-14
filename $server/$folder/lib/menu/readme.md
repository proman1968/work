# item-menu — контекстное меню handlers

## Что это

Всплывающее меню действий элемента: tools и/или дерево `~/handlers` (methods / pages). Технически — обёртка над `item-tree`; прикладное — выбор страницы или метода у текущего `$item`.

## Зачем это нужно

Правый клик / меню по иконке должны показывать доступные handlers без перехода в explorer. Корень `handlers` скрыт (`hideTops`), поэтому категории methods/pages видны сразу.

## Как это работает

- `handlersRoot` = `$item.fetch('handlers', { path })`.
- Режимы: `tools` | `handlers` | `both`.
- Корень `handlers` скрыт (`hideTops` / `hideRoots`); дерево показывает categories и пункты.
- Тот же `item-tree` / `item-node`, что explorer: `hide-readme` убирает `readme.md` из списка; «?» на родителе открывает связанный файл.

## Из чего это состоит

- [`menu.js`](/$server/$folder/lib/menu/menu.js/~/handlers/pages/form/) — компонент `item-menu`: список tools и дерево handlers

## В каком это состоянии

- ✅ режимы tools / handlers / both
- ✅ `hide-readme` + «?» через `item-node` (не отдельный handlers-help)

## Дальнейшие планы

- —
