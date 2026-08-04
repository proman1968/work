# Site — витрина класса (handlers/pages/site)

Краткая выжимка по архитектуре и граблям. Для быстрых задач по site читать этот файл.

## Назначение

Page-handler **site** — UI-витрина класса: вкладки (сам класс + дочерние `$class`) + iframe с контентом. Self открывает **site-main**, дочерний класс — **site-navigation**.

Связка трёх page: `site` → `site-navigation` → `site-main`.

## Ключевые пути

| Путь | Роль |
|------|------|
| `$server/$folder/$class/handlers/pages/site/$handler/class.js` | Канонический shell (вкладки, iframe, user-slot) |
| `$server/$folder/$class/handlers/pages/site-navigation/$handler/class.js` | Дерево `$class` + sheet `site-main` |
| `$server/$folder/$class/handlers/pages/site-main/$handler/class.js` | Базовый контент (hero) — наследуется всем |
| `$server/$folder/lib/site-loc/site-loc.js` | Общие helpers `#ctx=…` / location (клиент: `await import($item.short + '/~/lib//site-loc.js')`, без top-level import в class.js) |
| `$server/handlers/pages/site/$handler/class.js` | WORK shell: пустой `export default {}` |
| `$server/handlers/pages/site-main/$handler/class.js` | WORK product main |
| `sources/page.html` | Bootstrap любой page-страницы |

Открытие: `{item}/~/handlers//site/index.html`  
Self-вкладка: `{item}/~/handlers//site-main/`  
Дочерний класс: `{child}/~/handlers//site-navigation/`

## Shell

Chrome: tabs + user-slot + sheet с iframe (полноценные page).

`default_view: 'site-main'`. Self → `…/site-main/`; children → `…/site-navigation/`.

## Auth / top

Показ user-slot только при **`WORK.top === window`**. Слева от auth (только если залогинен) — `icons:open-in-new` → новая вкладка `…/~/handlers//explorer/`.

## Iframe keep-alive

Не менять `src` у существующего iframe. Накапливать frames, переключать через `~show`.

## Гости

В `page.html`: whitelist `site` | `site-navigation` | `site-main`.

## Чеклист

1. Канон в `$folder/$class/…/pages/site/$handler`.
2. Self → `site-main`, child → `site-navigation`.
3. Auth / explorer только при `WORK.top === window`.
4. Iframe — keep-alive + `~show`.
