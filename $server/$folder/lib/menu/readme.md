# item-menu — контекстное меню handlers

## Что это

Всплывающее меню действий элемента: tools и/или дерево `~/handlers` (methods / pages). Технически — обёртка над `item-tree`; прикладное — выбор страницы или метода у текущего `$item`.

## Зачем это нужно

Правый клик / меню по иконке должны показывать доступные handlers без перехода в explorer. Корень `handlers` скрыт (`hideTops`), поэтому категории methods/pages видны сразу.

## Как это работает

- `handlersRoot` = `$item.fetch('handlers', { path })`.
- Режимы: `tools` | `handlers` | `both`.
- Корень `handlers` скрыт (`hideTops` / `hideRoots`); дерево показывает categories и пункты.
- Справка по handlers — через `readme.md` в дереве / explorer, не отдельной кнопкой в меню.

## Из чего это состоит

- [`menu.js`](/$server/$folder/lib/menu/menu.js/~/handlers/pages/form/) — компонент `item-menu`: список tools и дерево handlers

## В каком это состоянии

- ✅ режимы tools / handlers / both
- ✅ без отдельного UI «handlers-help» (архитектура: меню = tools + tree)

## Дальнейшие планы

- —
