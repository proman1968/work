# Preview микрочата (ai.task)

Декларативная проекция JSON `ai.task` на ODA-views ([`rules/rules.md`](/rules/rules.md/~/handlers/pages/form/) Part B: один `data`, геттеры, `$pdp`).

## 1. Что это

Shell + `ui/`: лента, док закрытых контейнеров (wide), промптбар. Источник правды — `data` файла; дети получают `:data` / `:$item`.

## 2. Зачем это нужно

Показать дерево задачи и дать пользователю писать промпты, принимать plan/form и останавливать стрим — без знания внутренностей PIPE.

## 3. Как это работает

- Shell: `streamTarget` = focused без `content`/`html` (слот, не факт стрима); `streamingText` на delta; `streaming` только `chat.delta` / `chat.done`, не с `streamTarget` на `changed`; `changed`/`chat.done` → `load()`.
- Док (есть отчёты + `dockOpen`): `mobileMode` — ширина `100%`, лента скрыта (`showFeed`); иначе `max-width: 50%` + сплиттер. Список — кто закрылся раньше (дети, потом родители). `dockOpen` / ширина сплиттера — `$save`. Кружок `.dock-over`. Бар `header`: `←` `n/N` `→` имя save copy share скрыть. Вьюер `content`. Save — флаг и JSON задачи до `save_file`, иначе `changed`/`load` стирает `saved`. Кнопка: нет флага — `success-invert`, есть — `disabled`. Тот же `content` в ленте и в доке.
- Панель: `pending` (вертушка/стоп) — send и `chat.delta`; `chat.done` гасит сразу. Между шагами auto-loop `chat.done` нет. Локацию панель не шлёт — `body.location` ставит `on_save`.
- `focusedBlock` — последний не-`hidden` в живой ветке (`content` / без `items` — стоп спуска).
- `pinned` — авто-open у `focusedBlock` и предков на пути к нему. Сосед / закрытая площадка не на пути — сворачивается свободно.
- Топ-лента (`microchat-ribbon` + `$item`): scroll follow только при `stickBottom`; уход вверх отменяет pending `pinBottom`.
- Sticky: `todo` / `prompt` — host (`todo` = 0, `prompt` = высота todo). Контейнер — `summary`: todo + ближайший `previousSibling` prompt + шапка родителя.
- Action-bar: строковый `stop` — зелёная APPROVE + крестик (нет при `streamTarget`). Иначе открытый корень (`!content` + `items`) и не `pending` / не `streaming` / не `stop: true` — синяя «Продолжить» без крестика, `role:'AI'`.
- Шапка блока: скрыта только при `stop === true` (конец ветки); строка-`stop` (planning/form/complete) шапку не прячет. В шапке `data.state` — суть своей зоны (`2/2 Сайт` у web, `1 Интернет` у обзора), не фаза.
- Вид блока: `showTitle` — `color-mode: light`, тело `xx-small`; иначе (`stop: true`) — `content`, шрифт `small`. `todo` и `step` — `header`. Пока стрим на блоке — `oda-markdown-viewer` тоже `xx-small`. `prompt` по-прежнему `info-invert`. Лента для `step`/`prompt`/`form`/`todo` всегда `microchat-view-*`. Шапка `step`: `N. название` (`todo.recalc` / fallback из `todo.steps` по `Reactor.equal`); фаза в шапке не показывается.
- Полоска слева у тела — только контейнер (`:host([container])`, `data.items` — массив).
- Form-слот: колонка (`--vertical`); fieldset `max-width: 400px`; default `microchat-form` рисует `data.html`. Поле ввода у «Другое» скрыто, пока пункт не выбран.
- Html-слот: `microchat-html` — `iframe[srcdoc]` + sandbox (`allow-scripts`); высота по `postMessage`.
- `site` — обычный блок: `label` = hostname, тело = `content` (метка `[site N: url]` + обзор). `data.url` есть у слота.

## 4. Из чего это состоит

```
class.js       ← мета хендлера (init)
file.js        ← визуалка-шелл: data, focusedBlock, streamTarget, dockReports
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
| [`file.js`](file.js) | Шелл: `streamTarget` / `streaming` / `streamingText` / `dockReports`; delta/done. |
| [`ui/dock.js`](ui/dock.js) | Стрелки `n/N` + имя + copy/share/save + markdown `content`. |
| [`ui/views.js`](ui/views.js) | Ribbon + views. Form-слот / html-iframe. Scroll: `stickBottom`. |
| [`ui/ribbon.js`](ui/ribbon.js) | Черновик/дубль ленты. |
| [`ui/panel.js`](ui/panel.js) | `actionButton` = строка `focusedBlock.stop` (нет при `streamTarget`). APPROVE: `accept` + для form `prompt` = JSON `$pdp.result`. |
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
- **Action:** строковый `stop` — APPROVE + крестик (`null` при `streamTarget`). Иначе «Продолжить» (`role:'AI'`, без крестика) при открытом корне и не `pending`/`streaming`/`stop: true`. Form: `prompt` = JSON `$pdp.result`.
- **Form:** слот только при `html`; `result` — снимок контролов; оболочка пробрасывает `view.result` → `$pdp.result`.
- **Html:** `block.html` → SPA в `iframe srcdoc` (sandbox); без APPROVE, конец ветки (`stop`).
- **Pinned:** авто-open у `focusedBlock` и предков на спуске. Не на пути — стрелка свободная.
- **Stream:** `streamTarget` = focused без тела (слот). `streaming` — только delta/done. `typeIcon` крутит, только если оба; в JSON не пишется. `streamingText` на delta. Панель: `pending` на send/`chat.delta`, гашение на `chat.done`; `fetch('stop')` → `_stopped`.
- **Load:** `$item.load()` в shell на set / changed / chat.done.
