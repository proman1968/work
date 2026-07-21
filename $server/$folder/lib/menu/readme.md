# item-menu — контекстное меню handlers

## Что это

Всплывающее меню действий элемента: tools и/или дерево `~/handlers` (methods / pages). Технически — обёртка над `item-tree`; прикладное — выбор страницы или метода у текущего `$item`.

## Зачем это нужно

Правый клик / меню по иконке должны показывать доступные handlers без перехода в explorer. Корень `handlers` скрыт (`hideTops`), поэтому категории methods/pages видны сразу.

## Как это работает

- `handlersRoot` = `$item.fetch('handlers', { path })`.
- Дерево с `hide-readme`: `readme.md` не пункты меню; у узлов со своим readme — «?» на `item-node`.
- Корень `handlers` скрыт, поэтому для `handlers/readme.md` отдельная кнопка «?» над деревом (`hasHandlersReadme` / `openHandlersReadme`).
- В explorer фильтр не действует — там `readme.md` остаётся в списке файлов.

## Из чего это состоит

- [`menu.js`](/$server/$folder/lib/menu/menu.js/~/handlers/pages/form/) — компонент `item-menu`: tools, handlers-tree, справка корневого readme (контекстное меню элемента)

## В каком это состоянии

- ✅ режимы tools / handlers / both
- ✅ кнопка «?» для корневого `handlers/readme.md` при hideTops
- ✅ скрытие readme только в этом меню (`hide-readme`)

## Дальнейшие планы

- При необходимости перенести кнопку корневой справки в title popover
