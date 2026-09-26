# Preview микрочата (ai.task)

Декларативная проекция JSON `ai.task` на ODA-views ([`rules/rules.md`](/rules/rules.md/~/handlers/pages/form/) Part B: один `data`, геттеры, `$pdp`).

## 1. Что это

Shell + `ui/`: лента, док закрытых box (wide), промптбар. Источник правды — `data` файла; дети получают `:data` / `:$item`.

## 2. Зачем это нужно

Показать дерево задачи и дать пользователю писать промпты, принимать plan/form и останавливать стрим — без знания внутренностей PIPE.

## 3. Как это работает

- Shell: `pending` — вход в `prompt` (`chat.start`) до выхода (`chat.done`). На set — строго `WORK.chatPending[short|path] === true` (не `item.chatPending`: незнакомое свойство клиентского item — truthy Promise из `_onEmpty`). `streamTarget` = focused без `content` (слот, не факт стрима); `streamingText` на delta; `streaming` только `chat.delta` / `chat.done`; `changed`/`chat.done` → `load()`.
- Док (есть отчёты + `dockOpen`): `mobileMode` — ширина `100%`, лента скрыта (`showFeed`); иначе `dockStyle` = `dockWidth` px + `max-width: 50%` + сплиттер (`::width`). Отчёт — `doc && content && !error` (признак `doc` врождённый: копируется в блок из узла pipe при `_build_block`; `error: true` ставит pipe при сбое — неудачные web/site/file в док не попадают, в ленте их шапка красится `colorMode: error`). Обход — `items`, дети раньше родителя; корень с `content` — в конец. Тело — тот же `microchat-view-*` (`viewTag`), что в ленте; слот — лист на панель (`only-doc` → `--content`, не `info-invert` по высоте текста). Html в доке — тот же iframe + `HEIGHT_PING`, что в ленте. Md — скролл на хосте `only-doc`. Стрелки — `pickDock(i)` + `_bindSheet`: ODA `~if`/`~is` тот же тег не пересоздаёт узел (`replacer[tag]`), поэтому лист получает `data` явно и `_wakeSheet` (кэш `viewContent`/`$file`/`previewTag`). Бар `n/N` и тело — один `current`. Имя: `path` → basename файла, иначе `label`/`type`. Save неактивен, если `saved` или есть `path` (файл уже на диске; generate после `save_file` ставит `saved: true`). Для md/html без path: флаг в JSON до `save_file`, иначе `changed`/`load` стирает. Имя файла сохранения: `type === 'html'` → `.html` и `content`; иначе `.md`. Кнопка: нет флага и нет path — `success-invert`, иначе `disabled`. `dockOpen` / `dockWidth` — `$save`. Кружок `.dock-over`. Бар `header`: `←` `n/N` `→` имя save copy share скрыть.
- Панель: стоп/вертушка — `$pdp.pending` (владелец — шелл), в бар `:pending`. `work-prompt-bar` — `:is-build` / attr `success` при `data.mode === 'build'`; action-bar снаружи. Auto-loop без `chat.done` (ранний `return`); `done` — только выход из `prompt`. Локацию панель не шлёт — место в `body.system` пишет `on_save`.
- `focusedBlock` — последний не-`hidden` в живой ветке; стоп на листе (`!items`). `content` на box с детьми (маркер includes/expand) спуск не обрывает. Пустой `ignore` (`reasoning`) — слот живого CoT; с `content` перешагивается (на диске блок не остаётся — сервер вырезает по концу think). Исключение: `ignore` с `doc`/`stop` (`html`) — артефакт, в фокус попадает.
- `pinned` — авто-open у `focusedBlock` и предков на пути к нему; шеврона нет (закрыть нельзя). Сосед / закрытый блок не на пути — сворачивается свободно.
- Топ-лента (`microchat-ribbon` + `$item`): scroll follow только при `stickBottom`. Вкл/выкл follow — только намерение пользователя: `wheel` вверх / `touchmove` / drag скроллбара вверх — стоп; `wheel` вниз у низа / `touchend` у низа / отпускание drag у низа — снова follow. `scroll`+`nearBottom` follow **не** включает (иначе докрутка стрима ловит follow обратно на первом wheel вверх).
- Sticky-стека нет (как в образце): строки раскрываются фокусом стрима и кликом, липких поверхностей и DOM-обходов нет.
- Action-bar: `~if="!pending && actionButton?.label"`. Строковый `stop` — `APPROVE` + крестик (нет при `streamTarget`). `stop: true` — кнопки нет (штатная пауза: вопрос/ответ). «Продолжить» (`role: 'AI'`) только `data.halt` `stop`|`crash`. `sendAction` шлёт `role` кнопки; form: JSON `$pdp.result` **до** `pending`. `userRole` только у send из инпута.
- Шапка блока: три слота — **тип** (`label` / `type`) | **название** (`pathBasename(path)` или url) | **результат** (`tickText` или `state`). `generate` пока не `done` — `tickText` = `m:ss` от `data.time` (клиент). Скрыта только при `stop === true`. `data.label` у stop-блоков не пишется. При `stop: true` `title` на `details` — `data.menu`. Времени и удаления в шапке нет.
- Вид блока: `showTitle` — `color-mode: light`, тело `xx-small`; иначе (`stop: true`) — `content`, шрифт `small`. `todo` и `step` — `header`. Пока стрим на блоке — `oda-markdown-viewer` тоже `xx-small`. `prompt` по-прежнему `info-invert`. У `ignore` (reasoning) на `.body` нет attr `content` — не белая «бумага» поверх info-invert шапки. Лента для `step`/`prompt`/`form`/`todo`/`html`/`file`/`generate` всегда `microchat-view-*`. `file` с `crit` (check) — `microchat-view` без превью. `file`/`generate` с `path` — `{ext}-preview` или `item-node`. Шапка `step`: `N. название` (`todo.recalc` / fallback из `todo.steps` по `Reactor.equal`); фаза в шапке не показывается. Тело (`.body`): `overflow-x: auto` — широкая md-таблица скроллится, не раздувает ленту.
- Полоска слева у тела — только box (`:host([box])`, `data.items` — массив).
- Лента — строки проекции (`ui/rows.js` → `ui/row.js`): `prompt` (плашка), `thinking` (свернут), `text`, `agent` (шапка + свернутые дети), `approval` (шапка; вопрос/план — текст; сданное — ответы), `todo` (шапка + прогресс), `media` (только шапка), `attachment`, `diff` (файлы со статусами), `error`. Домен строки: `config`/`data`/`people`. `html` в фокусе — превью над панелью (`htmlControl` шелла): высота по пингу контента (`microchatHeight` из iframe), иначе прямой замер `scrollHeight` (sandbox `allow-scripts allow-same-origin` — приложения свои, сгенерированные), кэп 80vh, без замера — 80vh. Пинг-скрипт в новые приложения кладет `html`-агент (промпт). Док: `only-doc` — iframe 100% на лист, замер не нужен.
- Ховер-бары строк: промпт — `режим · модель · время` + «Сбросить» + «Копировать»; ответ — «Копировать» + `режим · модель · длительность`. Снимки: `mode/model` в промпте при отправке (и в ответе при создании), `durationMs` по факту стрима (`fill`/`_fillLeaf`). Сброс — метод `revert { id }`: сопоставить по `id`, текст + вложения в ввод (`panel.prefill`), усечение в порядке документа (`truncateAfter`), чистка `using_blocks/halt/waiting/цели/todo/skill`. Только лента (v1, без отката файлов).
- Все контролы — в полосе над панелью (`controlType/controlData` шелла: форма/quiz → `html` в фокусе → висящий `todo`). Общий `action-bar` скрыт, когда контрол со своими кнопками (`form`/`quiz`).
- Legacy `microchat-form` и sticky-механика (`topRibbon`/`layoutTick`/`todoView`/`prevPrompt`/`headerStyle`) удалены. Todo в шапке ленты — `microchat-row-todo`.
- Html-слот: `type === 'html'` → `microchat-html` `iframe[srcdoc]` + sandbox (`allow-scripts`); страница из `content` (`unwrapFence`). Лента и док — высота по контенту (`HEIGHT_PING`, не `100vh`; `50vh` только до замера).
- `site` — шапка (`label`/`state`, `data.url`). Лист: тело пустое (`draft` не показывать). Узел: тело — сводка (`content`) после обхода `pages`. Без `page`.

## 4. Из чего это состоит

```
class.js       ← мета хендлера (init)
file.js        ← визуалка-шелл: data, pending, focusedBlock, streamTarget, dockReports
ui/views.js    ← microchat-ribbon + microchat-view-* (фолбэк) + microchat-html
ui/rows.js     ← проекция блок → строка (kind/status/control/domain)
ui/row.js      ← строки: prompt/thinking/text/error/agent/approval/todo/attachment/diff/media
ui/form.js     ← microchat-control-form (слот: спека + свои кнопки)
ui/quiz.js     ← microchat-control-quiz (слот: прогресс + активная форма + свои кнопки)
ui/todo.js     ← microchat-control-todo (слот: чеклист)
ui/html.js     ← microchat-control-html (слот: превью)
ui/dock.js     ← док: селектор + content закрытых
ui/panel.js    ← microchat-panel (action-bar + work-prompt-bar; tts/usage)
ui/tts.js      ← TtsController
ui/usage.js    ← buildUsageStats / fmtTokens
```

| Модуль | Факт |
|--------|------|
| [`class.js`](class.js) | Мета. Без ESM. |
| [`file.js`](file.js) | Шелл: `pending` / `streamTarget` / `streaming` / `streamingText` / `dockReports`; `formBlock` / `checkGap` / `result` из `values/answer`; delta/done. |
| [`ui/dock.js`](ui/dock.js) | Стрелки `n/N` + имя + copy/share/save + тот же `viewTag`, что лента. |
| [`ui/views.js`](ui/views.js) | Ribbon (проекция → строки, фолбэк — старые view) + `microchat-html`. Scroll: `stickBottom` (stop/resume — только wheel/touch/drag, не scroll+nearBottom). |
| [`ui/panel.js`](ui/panel.js) | Action-bar + `work-prompt-bar`. `:model` / `:effort` one-way от `data` + `@model-changed.stop` / `@effort-changed.stop`; `::tts-mode`; `:pending` с шелла. Mic в баре. `actionButton`: строка `stop` → `APPROVE`; `stop: true` → нет кнопки; «Продолжить» только `halt` stop/crash; скрыт при своих кнопках контрола (`form`/`quiz`). Send из инпута — `userRole`. |
| [`ui/tts.js`](ui/tts.js) | `off` / `local` / `browser`; delta → speak на done. |
| [`ui/usage.js`](ui/usage.js) | Usage из `data.usage` + walk `data.items`. Лимит: `usage.contextLimit` → `maxTokens` модели → 128k. Бар — состав `used` (System + Диалог), масштаб от лимита, остаток — трек; «Ответы (сессия)» — только строка легенды (`rows`). |

## 5. В каком это состоянии

- ✅ Лента-строки, stream, stick-scroll; action-bar скрыт при `streamTarget`
- ✅ Один источник ribbon — `ui/views.js` + `ui/row.js` (дубль `ui/ribbon.js` удалён)

## 6. Дальнейшие планы

- Построчный diff в карточке `diff` (тексты до/после из `history`)

## Контракты (как в коде)

- **Модель / effort:** picker и цикл — `work-prompt-bar`; источник — файл (`data.model` / `data.effort`), поэтому one-way `:model` / `:effort` вниз + `@model-changed.stop` / `@effort-changed.stop` вверх (запись в `data` и `fetch('change_model'|'change_effort')`, пустое эхо бара игнорируется). Two-way `::` тут запрещён: асинхронная загрузка файла даёт бару стрельнуть пустым `model-changed` раньше первого чтения — значение с файла терялось. `.stop` обязателен: события `fire` composed и всплывают из микрочата до `oda-chat`, где их ловит two-way `::model` главного чата.
- **Меню блока:** `data.menu` — текст выбора (`TYPE - inject`, при нескольких вариантах — с инструкцией модели). При `stop: true` — `title` на `details`. Времени и удаления в шапке нет.
- **Action:** роль с кнопки. Строковый `stop` — `APPROVE` + `accept` + крестик (`null` при `streamTarget`); form: `prompt` = JSON `$pdp.result` **до** `pending`. `stop: true` — action-bar пуст. «Продолжить» (`role: 'AI'`) только `data.halt` `stop` (Стоп) или `crash` (обрыв). Модель в `prompt` не передаётся — она в `body.model`, смена только `change_model`.
- **Form:** инлайн-контрол в строке `approval` (`item-editor-form` по спеке), пока нет `approved`; `result` — `values`/`answer`; `approve` пишет оба. После `approved` — тело markdown ответов (без `[form answers]`). Шелл: `$pdp.formBlock` / `checkGap` / `result` из `values/answer`.
- **Html:** `type === 'html'` → `content` (`unwrapFence`) в `microchat-html` `iframe srcdoc` (`allow-scripts`); лента и док — ping по контенту; без APPROVE.
- **File:** `type === 'file'` без `crit` / `generate` — `microchat-view-file`: `$file` с `path`, тег `{ext}-preview` после `loadPreview`, иначе `item-node`. Смена `data` — `_wakeSheet` (сброс preview/`$file`); устаревший `loadPreview` не ставит тег. `file` с `crit` (check) — `microchat-view` без превью. Шапка: тип | имя файла | `state`. `generate` в работе — `tickText` `m:ss` (слот `blockState`, не JSON); после записи — `path` + `saved`. Картинку не OCR-ят в markdown. `png-preview`: `object-fit: contain`; чат/лента — `max-height: 150px`; док (`only-doc` на слоте) — `flex` + contain на панель. Не путать с `flex` у chat-item.
- **Pinned:** авто-open у `focusedBlock` и предков в `activeIds` (цепочка `focusChainIds`); у предков, пока `pending`, иконка-волна. Фокус ушел — сворачивается, кроме раскрытых вручную (`userOpen`). Старые view: клик по шапке — `preventDefault`, открытие только `userOpen`.
- **Stream:** `streamTarget` = focused без тела (слот). `streaming` — только delta/done. `typeIcon` — вертушка при `$pdp.pending` и пустом `content`; в JSON не пишется. `streamingText` на delta. `pending`: `chat.start` (вход `prompt`) … `chat.done` (выход). set — карта `WORK.chatPending` (строго `=== true`). `fetch('stop')` → `_stopped`.
- **Load:** `$item.load()` в shell на set / changed / chat.done — сериализованно (`_reload`): один load в полёте, события во время загрузки схлопываются в одну повторную после её завершения (параллельные load приходили вразнобой и старый ответ перетирал финальный). Ошибка load не убивает цикл: повтор с нарастающей паузой, до 5 попыток (реджект финальной загрузки сжигал накопленный повтор — лента застывала без последнего блока до F5). Свежесть запроса гарантирует ядро: URL load включает версию item, версия поднимается до `fire('changed')` (client.js).
