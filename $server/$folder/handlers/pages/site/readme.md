# Site — витрина класса (handlers/pages/site)

Краткая выжимка по архитектуре и граблям. Для быстрых задач по site читать этот файл.

## Назначение

Page-handler **site** — UI-витрина класса: вкладки (сам класс + дочерние `$class`) + iframe с контентом. Вложенный view **main** — главная страница внутри shell.

## Ключевые пути

| Путь | Роль |
|------|------|
| `$server/$folder/handlers/pages/site/$handler/class.js` | Канонический shell (вкладки, iframe, user-slot) |
| `$server/$folder/handlers/pages/site/main/$handler/class.js` | Базовый main (hero) — наследуется всем |
| `$server/handlers/pages/site/$handler/class.js` | WORK shell: пустой `export default {}` (merge с `$folder` через `~/class.js`) |
| `$server/handlers/pages/site/main/$handler/class.js` | WORK product main (hero + возможности + слои + модули) |
| `sources/page.html` | Bootstrap любой page-страницы |

Открытие: `{item}/~/handlers//site/index.html`  
Вложенный view: `{item}/~/handlers//site/main/` → в `page.html` `handler=site`, `view_name=main`.

## Shell: два режима

- **Без `view_name`** — chrome: tabs + user-slot + sheet с iframe.
- **С `view_name`** — только mount nested view в `#view-host` (контент iframe).

`default_view: 'main'`. Первая вкладка (self) → `…/site/main/`; дочерние классы → полный `…/site/` их shell.

## Iframe keep-alive

**Никогда** не менять `src` у существующего iframe (Chromium SIGSEGV). Накапливать frames и переключать через `~show` (как explorer).

## User-slot (вход / аватар)

- Только на **верхнем** shell: `isTopSite` → `window.parent === window` (во вложенном site в iframe слота нет).
- Гость: квадратная `oda-button` «Войти».
- Авторизован: круглая `item-user` (`~/lib//user`).
- `@tap` → `WORK.showModal(ODA.createComponent('user-profile'), …)`.
- Инвалидация после auth: `WORK.authEvents` / `AUTH_CHANNEL`.

## Гости: редирект на site

В [`sources/page.html`](../../../../sources/page.html) после `WORK.login()`:

- если `!WORK.uid` и `{handler} !== 'site'` → `location.replace(…/~/handlers//site/index.html)` контекста;
- site и `site/*` (в т.ч. main в iframe) гостю доступны;
- top-level `return` в `<script type="module">` **нельзя** — только `if/else`.

## Критические грабли

### 1. WORK `pages/site` обязан быть типизированным `$handler`

Папка `site` **без** `$handler/` перехватывает `handlers//site` и отдаёт JSON / чужой модуль → MIME `application/json` у module script.

Даже если override только `main/`, у `site` всё равно нужен `$handler/` (достаточно `export default {}`). Иначе `main.parent` не `$handler` → `getIndexForPage` даёт `handler=main`, `view_name=''` → гостевой редирект в `page.html` снова открывает `site` вместо main.

Правило: любой `$server/handlers/pages/site` = `$handler/` (+ опционально `main/$handler/`).

### 2. Нельзя re-export shell через `export { default } from '…'`

`~/class.js` мержит цепочку наследования через babel-merge, который понимает только `export default {…}`.  
`export { default } from '…'` даёт **Duplicate export of 'default'**.

Для shell достаточно пустого `export default {}` в WORK — merge подтянет канон из `$folder`. Полная копия нужна только при реальных отличиях shell.

Прямой путь `…/$handler/class.js` (без `~/`) отдаёт файл как есть; `…/$handler/~/class.js` — merge с предками (в т.ч. `$folder/class.js` с testVal).

### 3. Deep search `handlers//site`

С `$server/handlers/pages/site/$handler` deep search с корня WORK находит WORK-override раньше `$folder/…/pages/site`.

## Паттерны для копирования

- Auth UI: `sources/modules/user-profile/user-profile.js` (подключён в `sources/client.js`).
- Avatar: `item-user` = `item-icon` + `round`.
- Landing auth modal: `paas/$paas/handlers/pages/landing/$handler/class.js` (`_askAuth`).
- page fill: `sources/server/server.js` → `getIndexForPage` (`{item_path}`, `{handler}`, `{view_name}`).

## Чеклист при правках site

1. Править канон в `$folder/…/pages/site/$handler`.
2. WORK `pages/site` всегда с `$handler/` (пустой `{}` или отличия shell; не re-export).
3. Не создавать `$server/handlers/pages/site` без `$handler` — даже при override только `main`.
4. User-slot только при `window.parent === window`.
5. Iframe — только keep-alive + `~show`.
