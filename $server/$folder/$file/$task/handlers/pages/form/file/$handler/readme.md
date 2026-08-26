# Preview микрочата (ai.task)

Декларативная проекция JSON `ai.task` на ODA-views ([`rules/rules.md`](/rules/rules.md/~/handlers/pages/form/) Part B: один `data`, геттеры, `$pdp`).

## 1. Что это

Shell + `ui/`: лента, док закрытых box (wide), промптбар. Источник правды — `data` файла; дети получают `:data` / `:$item`.

## 2. Зачем это нужно

Показать дерево задачи и дать пользователю писать промпты, принимать plan/form и останавливать стрим — без знания внутренностей PIPE.

## 3. Как это работает

- Shell: `pending` — send / `chat.delta` / `changed` при пустом слоте; гашение на `chat.done` / stop. На set слот не включает `pending` (повторный вход в остановленную задачу — «Продолжить», не вертушка). `streamTarget` = focused без `content`/`html` (слот, не факт стрима); `streamingText` на delta; `streaming` только `chat.delta` / `chat.done`; `changed`/`chat.done` → `load()`.
- Док (есть отчёты + `dockOpen`): `mobileMode` — ширина `100%`, лента скрыта (`showFeed`); иначе `dockStyle` = `dockWidth` px + `max-width: 50%` + сплиттер (`::width`). Отчёт — `box && content` (не «есть `items`»). Обход — `items`, дети раньше родителя; корень с `content` — в конец. Тело — тот же `microchat-view-*` (`viewTag`), `onlyDoc`: без шапки и без детей. `dockOpen` / `dockWidth` — `$save`. Кружок `.dock-over`. Бар `header`: `←` `n/N` `→` имя save copy share скрыть. Save — флаг и JSON задачи до `save_file`, иначе `changed`/`load` стирает `saved`. Имя: `html` / страница → `.html` и `block.html` (как iframe); иначе `.md` и `content`. Кнопка: нет флага — `success-invert`, есть — `disabled`.
- Панель: стоп/вертушка — `$pdp.pending` (владелец — шелл). Composer — attr `error` при `data.mode === 'do'`. Между шагами auto-loop `chat.done` нет. Локацию панель не шлёт — место в `body.system` пишет `on_save`.
- `focusedBlock` — последний не-`hidden` в живой ветке (`content` / без `items` — стоп спуска).
- `pinned` — авто-open у `focusedBlock` и предков на пути к нему. Сосед / закрытая площадка не на пути — сворачивается свободно.
- Топ-лента (`microchat-ribbon` + `$item`): scroll follow только при `stickBottom`; уход вверх отменяет pending `pinBottom`.
- Sticky: одна поверхность на блок. `todo` / `prompt` — host (`todo` = 0, `prompt` = высота todo), `summary` в потоке. Контейнер — только `summary`: todo + ближайший `previousSibling` prompt + шапка родителя.
- Action-bar: `~if="!pending && actionButton?.label"`. Роль на кнопке: строковый `stop` — `APPROVE` + крестик (нет при `streamTarget`); «Продолжить» (`role: 'AI'`) только если хвост не `prompt` и не `stop: true`. `sendAction` шлёт `role` кнопки; `userRole` только у send из инпута.
- Шапка блока: скрыта только при `stop === true` (конец ветки); строка-`stop` (planning/form/report) шапку не прячет. `data.label` после контента — 2–3 слова от модели (пока стрим — ярлык типа). В шапке `data.state` — суть своей зоны (`2/2 Сайт` у web, `1 Интернет` у обзора), не фаза. При `stop: true` `title` на `details` — `data.menu`. Времени и удаления нет.
- Вид блока: `showTitle` — `color-mode: light`, тело `xx-small`; иначе (`stop: true`) — `content`, шрифт `small`. `todo` и `step` — `header`. Пока стрим на блоке — `oda-markdown-viewer` тоже `xx-small`. `prompt` по-прежнему `info-invert`. Лента для `step`/`prompt`/`form`/`todo`/`html` всегда `microchat-view-*`. Шапка `step`: `N. название` (`todo.recalc` / fallback из `todo.steps` по `Reactor.equal`); фаза в шапке не показывается.
- Полоска слева у тела — только box (`:host([box])`, `data.items` — массив).
- Form-слот: колонка (`--vertical`); fieldset `max-width: 400px`; default `microchat-form` рисует `data.html`. Поле ввода у «Другое» скрыто, пока пункт не выбран.
- Html-слот: `microchat-html` — `iframe[srcdoc]` + sandbox (`allow-scripts`); высота по `postMessage`. `pageHtml` снимает ```` ```html ```` с `content`, если нет `data.html`.
- `site` — обычный блок: `label` = hostname, тело = `content` (метка `[site N: url]` + обзор). `data.url` есть у слота.

## 4. Из чего это состоит

```
class.js       ← мета хендлера (init)
file.js        ← визуалка-шелл: data, pending, focusedBlock, streamTarget, dockReports
ui/views.js    ← microchat-ribbon + microchat-view-* + microchat-form
ui/dock.js     ← док: селектор + content закрытых
ui/ribbon.js   ← дубль ribbon (scroll-контракт; шелл не импортирует)
ui/panel.js    ← microchat-panel (+ mic/tts/usage)
ui/mic.js      ← MicAudioController
ui/tts.js      ← TtsController
ui/usage.js    ← buildUsageStats / fmtTokens
```

| Модуль | Факт |
|--------|------|
| [`class.js`](class.js) | Мета. Без ESM. |
| [`file.js`](file.js) | Шелл: `pending` / `streamTarget` / `streaming` / `streamingText` / `dockReports`; delta/done. |
| [`ui/dock.js`](ui/dock.js) | Стрелки `n/N` + имя + copy/share/save + `viewTag` / `onlyDoc`. |
| [`ui/views.js`](ui/views.js) | Ribbon + views. Form-слот / html-iframe. Scroll: `stickBottom`. |
| [`ui/ribbon.js`](ui/ribbon.js) | Черновик/дубль ленты. |
| [`ui/panel.js`](ui/panel.js) | `actionButton.role`: строка `stop` → `APPROVE` + `accept` (form: `prompt` = JSON `$pdp.result`); «Продолжить» → `AI`. Send из инпута — `userRole`. Без `model`. |
| [`ui/mic.js`](ui/mic.js) | SpeechRecognition → `panel.value` / `recording` / `timer`. |
| [`ui/tts.js`](ui/tts.js) | `off` / `local` / `browser`; delta → speak на done. |
| [`ui/usage.js`](ui/usage.js) | Usage из `data.usage` + walk `data.items`. |

## 5. В каком это состоянии

- ✅ Лента, stream, stick-scroll; form/html; action-bar скрыт при `streamTarget`
- 🔧 Кастомные `data.ui` у form — CE по желанию
- 🔧 `ui/ribbon.js` не в load-path shell

## 6. Дальнейшие планы

- Один источник ribbon
- Примеры кастомных `microchat-form-*` под `data.ui`

## Контракты (как в коде)

- **Модель:** `data.model` → `WORK.get_item`; смена — picker `/MODELS` + `fetch('change_model', { model: path })`.
- **Меню блока:** `data.menu` — текст выбора (`TYPE - inject`, при нескольких вариантах — с инструкцией модели). При `stop: true` — `title` на `details`. Времени и удаления в шапке нет.
- **Action:** роль с кнопки. Строковый `stop` — `APPROVE` + `accept` + крестик (`null` при `streamTarget`); form: `prompt` = JSON `$pdp.result`. Иначе «Продолжить» (`role: 'AI'`) при открытом корне, не `pending`/`streaming`/`stop: true`, хвост не `prompt`. Модель в `prompt` не передаётся — она в `body.model`, смена только `change_model`.
- **Form:** слот только при `html`; `result` — снимок контролов; оболочка пробрасывает `view.result` → `$pdp.result`.
- **Html:** `block.html` или document в `content` (забор ```` ```html ```` снимает `pageHtml`) → `microchat-html` `iframe srcdoc` (`allow-scripts`); высота `postMessage`; без APPROVE.
- **Pinned:** авто-open у `focusedBlock` и предков на спуске. Не на пути — стрелка свободная.
- **Stream:** `streamTarget` = focused без тела (слот). `streaming` — только delta/done. `typeIcon` — вертушка при `$pdp.pending` и пустом `content`; в JSON не пишется. `streamingText` на delta. `pending` на шелле: send / `chat.delta` / `changed` при слоте; гашение на `chat.done` / stop. set из слота `pending` не ставит. `fetch('stop')` → `_stopped`.
- **Load:** `$item.load()` в shell на set / changed / chat.done.
