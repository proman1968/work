# Preview микрочата (ai.task)

Декларативная проекция JSON `ai.task` на ODA-views ([`rules/rules.md`](/rules/rules.md/~/handlers/pages/form/) Part B: один `data`, геттеры, `$pdp`).

## 1. Что это

Shell + `ui/`: лента, док закрытых box (wide), промптбар. Источник правды — `data` файла; дети получают `:data` / `:$item`.

## 2. Зачем это нужно

Показать дерево задачи и дать пользователю писать промпты, принимать plan/form и останавливать стрим — без знания внутренностей PIPE.

## 3. Как это работает

- Shell: `pending` — вход в `prompt` (`chat.start`) до выхода (`chat.done`). На set — строго `WORK.chatPending[short|path] === true` (не `item.chatPending`: незнакомое свойство клиентского item — truthy Promise из `_onEmpty`). `streamTarget` = focused без `content` (слот, не факт стрима); `streamingText` на delta; `streaming` только `chat.delta` / `chat.done`; `changed`/`chat.done` → `load()`.
- Док (есть отчёты + `dockOpen`): `mobileMode` — ширина `100%`, лента скрыта (`showFeed`); иначе `dockStyle` = `dockWidth` px + `max-width: 50%` + сплиттер (`::width`). Отчёт — `doc && content && !error` (признак `doc` врождённый: копируется в блок из узла pipe при `_build_block`; `error: true` ставит pipe при сбое — неудачные web/site/file в док не попадают, в ленте их шапка красится `colorMode: error`). Обход — `items`, дети раньше родителя; корень с `content` — в конец. Тело — тот же `microchat-view-*` (`viewTag`), `onlyDoc`: без шапки и без детей. `dockOpen` / `dockWidth` — `$save`. Кружок `.dock-over`. Бар `header`: `←` `n/N` `→` имя save copy share скрыть. Save — флаг и JSON задачи до `save_file`, иначе `changed`/`load` стирает `saved`. Имя: `type === 'html'` → `.html` и `content` (как iframe, `unwrapFence`); иначе `.md` и `content`. Кнопка: нет флага — `success-invert`, есть — `disabled`.
- Панель: стоп/вертушка — `$pdp.pending` (владелец — шелл), в бар `:pending`. `work-prompt-bar` — attr `error` при `data.mode === 'do'`; action-bar снаружи. Auto-loop без `chat.done` (ранний `return`); `done` — только выход из `prompt`. Локацию панель не шлёт — место в `body.system` пишет `on_save`.
- `focusedBlock` — последний не-`hidden` в живой ветке (`content` / без `items` — стоп спуска). Пустой `ignore` (`reasoning`) — слот живого CoT; с `content` перешагивается (на диске блок не остаётся — сервер вырезает по концу think).
- `pinned` — авто-open у `focusedBlock` и предков на пути к нему. Сосед / закрытая площадка не на пути — сворачивается свободно.
- Топ-лента (`microchat-ribbon` + `$item`): scroll follow только при `stickBottom`. Вкл/выкл follow — только намерение пользователя: `wheel` вверх / `touchmove` / drag скроллбара вверх — стоп; `wheel` вниз у низа / `touchend` у низа / отпускание drag у низа — снова follow. `scroll`+`nearBottom` follow **не** включает (иначе докрутка стрима ловит follow обратно на первом wheel вверх).
- Sticky: одна поверхность на блок. `todo` / `prompt` — host (`todo` = 0, `prompt` = высота todo), `summary` в потоке. Контейнер — только `summary`: todo + ближайший `previousSibling` prompt + шапка родителя. Офсеты считают DOM-обходы (`todoView` / `prevPrompt`) — Реактор их кэширует, а DOM-мутации не видит, поэтому у топ-ленты есть `layoutTick`: attach/detach любого view его бампает, обходы читают и пересчитываются (иначе план, появившийся посреди сессии, ломал стек шапок до перезагрузки).
- Action-bar: `~if="!pending && actionButton?.label"`. Роль на кнопке: строковый `stop` — `APPROVE` + крестик (нет при `streamTarget`); «Продолжить» (`role: 'AI'`) только если хвост не `prompt` и не `stop: true`. `sendAction` шлёт `role` кнопки; `userRole` только у send из инпута.
- Шапка блока: скрыта только при `stop === true` (конец ветки); строка-`stop` (planning/form/report) шапку не прячет. `data.label`: у stop-блоков не пишется (не виден); генерённые 2–3 слова от модели — только у doc-блоков (имя в доке), остальным хватает статичного ярлыка типа. В шапке `data.state` — суть своей зоны (`2/2 Сайт` у web, `1 Интернет` у обзора), не фаза. При `stop: true` `title` на `details` — `data.menu`. Времени и удаления нет.
- Вид блока: `showTitle` — `color-mode: light`, тело `xx-small`; иначе (`stop: true`) — `content`, шрифт `small`. `todo` и `step` — `header`. Пока стрим на блоке — `oda-markdown-viewer` тоже `xx-small`. `prompt` по-прежнему `info-invert`. У `ignore` (reasoning) на `.body` нет attr `content` — не белая «бумага» поверх info-invert шапки. Лента для `step`/`prompt`/`form`/`todo`/`html` всегда `microchat-view-*`. Шапка `step`: `N. название` (`todo.recalc` / fallback из `todo.steps` по `Reactor.equal`); фаза в шапке не показывается.
- Полоска слева у тела — только box (`:host([box])`, `data.items` — массив).
- Form-слот: колонка (`--vertical`); fieldset `max-width: 400px`; default `microchat-form` рисует разметку из `content` (`parseFormHtml`, старый `data.html` — фолбэк); подпись — хвост после fence. Поле ввода у «Другое» скрыто, пока пункт не выбран. `data.values` пишутся только на `@change` (на `@input` — лишь показ «Другое»): мутация data на каждый символ перерисовывала форму и теряла ввод; `restore()` не трогает контрол в фокусе.
- Html-слот: `type === 'html'` → `microchat-html` `iframe[srcdoc]` + sandbox (`allow-scripts`); страница из `content` (`unwrapFence`); высота по `postMessage`.
- `site` — обычный блок: `label` = hostname, тело = `content` (метка `[site N: url]` + обзор). `data.url` есть у слота.

## 4. Из чего это состоит

```
class.js       ← мета хендлера (init)
file.js        ← визуалка-шелл: data, pending, focusedBlock, streamTarget, dockReports
ui/views.js    ← microchat-ribbon + microchat-view-* + microchat-form
ui/dock.js     ← док: селектор + content закрытых
ui/panel.js    ← microchat-panel (action-bar + work-prompt-bar; tts/usage)
ui/tts.js      ← TtsController
ui/usage.js    ← buildUsageStats / fmtTokens
```

| Модуль | Факт |
|--------|------|
| [`class.js`](class.js) | Мета. Без ESM. |
| [`file.js`](file.js) | Шелл: `pending` / `streamTarget` / `streaming` / `streamingText` / `dockReports`; delta/done. |
| [`ui/dock.js`](ui/dock.js) | Стрелки `n/N` + имя + copy/share/save + `viewTag` / `onlyDoc`. |
| [`ui/views.js`](ui/views.js) | Ribbon + views. Form-слот / html-iframe. Scroll: `stickBottom` (stop/resume — только wheel/touch/drag, не scroll+nearBottom). Sticky: `layoutTick`. |
| [`ui/panel.js`](ui/panel.js) | Action-bar + `work-prompt-bar`. `:model` / `:effort` one-way от `data` + `@model-changed.stop` / `@effort-changed.stop`; `::tts-mode`; `:pending` с шелла. Mic в баре. `actionButton.role`: строка `stop` → `APPROVE` + `accept` (form: `prompt` = JSON `$pdp.result`); «Продолжить» → `AI`. Send из инпута — `userRole`. |
| [`ui/tts.js`](ui/tts.js) | `off` / `local` / `browser`; delta → speak на done. |
| [`ui/usage.js`](ui/usage.js) | Usage из `data.usage` + walk `data.items`. Лимит: `usage.contextLimit` → `maxTokens` модели → 128k. Бар — состав `used` (System + Диалог), масштаб от лимита, остаток — трек; «Ответы (сессия)» — только строка легенды (`rows`). |

## 5. В каком это состоянии

- ✅ Лента, stream, stick-scroll; form/html; action-bar скрыт при `streamTarget`
- ✅ Один источник ribbon — `ui/views.js` (дубль `ui/ribbon.js` удалён)
- 🔧 Кастомные `data.ui` у form — CE по желанию

## 6. Дальнейшие планы

- Примеры кастомных `microchat-form-*` под `data.ui`

## Контракты (как в коде)

- **Модель / effort:** picker и цикл — `work-prompt-bar`; источник — файл (`data.model` / `data.effort`), поэтому one-way `:model` / `:effort` вниз + `@model-changed.stop` / `@effort-changed.stop` вверх (запись в `data` и `fetch('change_model'|'change_effort')`, пустое эхо бара игнорируется). Two-way `::` тут запрещён: асинхронная загрузка файла даёт бару стрельнуть пустым `model-changed` раньше первого чтения — значение с файла терялось. `.stop` обязателен: события `fire` composed и всплывают из микрочата до `oda-chat`, где их ловит two-way `::model` главного чата.
- **Меню блока:** `data.menu` — текст выбора (`TYPE - inject`, при нескольких вариантах — с инструкцией модели). При `stop: true` — `title` на `details`. Времени и удаления в шапке нет.
- **Action:** роль с кнопки. Строковый `stop` — `APPROVE` + `accept` + крестик (`null` при `streamTarget`); form: `prompt` = JSON `$pdp.result`. Иначе «Продолжить» (`role: 'AI'`) при открытом корне, не `pending`/`streaming`/`stop: true`, хвост не `prompt`. Модель в `prompt` не передаётся — она в `body.model`, смена только `change_model`.
- **Form:** слот при разметке в `content` (fence); `result` — снимок контролов; оболочка пробрасывает `view.result` → `$pdp.result`.
- **Html:** `type === 'html'` → `content` (`unwrapFence`) в `microchat-html` `iframe srcdoc` (`allow-scripts`); высота `postMessage`; без APPROVE.
- **Pinned:** авто-open у `focusedBlock` и предков на спуске. Не на пути — стрелка свободная.
- **Stream:** `streamTarget` = focused без тела (слот). `streaming` — только delta/done. `typeIcon` — вертушка при `$pdp.pending` и пустом `content`; в JSON не пишется. `streamingText` на delta. `pending`: `chat.start` (вход `prompt`) … `chat.done` (выход). set — карта `WORK.chatPending` (строго `=== true`). `fetch('stop')` → `_stopped`.
- **Load:** `$item.load()` в shell на set / changed / chat.done — сериализованно (`_reload`): один load в полёте, события во время загрузки схлопываются в одну повторную после её завершения (параллельные load приходили вразнобой и старый ответ перетирал финальный). Ошибка load не убивает цикл: повтор с нарастающей паузой, до 5 попыток (реджект финальной загрузки сжигал накопленный повтор — лента застывала без последнего блока до F5). Свежесть запроса гарантирует ядро: URL load включает версию item, версия поднимается до `fire('changed')` (client.js).
