# Site-navigation — дерево навигации класса

## Что это

Page-handler **site-navigation** — витрина с деревом `$class` слева (`oda-app-layout` + `item-tree`) и sheet справа. Технически — page между `site` и `site-main`; прикладное — обзор иерархии классов от текущего контекста вниз.

## Зачем это нужно

У `site` верхние вкладки показывают только прямых потомков. Дерево даёт ту же модель прав/`$class`, но в глубину в одном экране, без рекурсивных page-shell.

## Как это работает

- Layout: `oda-app-layout` — как **explorer**: left-panel дерево (`style="height: 0"`), main — `flex vertical` + iframe `flex` / `border: none`.
- Корень дерева = `$item`; `only-classes` + `hide-system`; глубина по expand.
- Выбор узла (`site-nav-tree.execute` → `open_item`) → iframe `…/site-main/` (keep-alive + `~show`).
- Location: [`site-loc`](/$server/$folder/lib/site-loc/site-loc.js/~/handlers/pages/form/) (`#ctx=…` / `work-site-loc`); без вложенного nav. Подключение: `await import((this.$item?.short || '') + '/~/lib//site-loc.js')` в методах (не static import — babel-merge).
- Auth: `left_buttons` drawer (как explorer), только при `WORK.top === window`.

Открытие: `{item}/~/handlers//site-navigation/index.html`

## Из чего это состоит

- [`$handler/class.js`](/$server/$folder/$class/handlers/pages/site-navigation/$handler/class.js/~/handlers/pages/form/) — shell + `site-nav-tree`

Связанные page: [`site`](/$server/$folder/$class/handlers/pages/site/readme.md/~/handlers/pages/form/), `site-main`.

## В каком это состоянии

- ✅ дерево `$class`, sheet full-size, location, auth top, guest whitelist

## Дальнейшие планы

- —
