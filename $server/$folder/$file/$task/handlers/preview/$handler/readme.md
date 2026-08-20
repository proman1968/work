# Preview микрочата (ai.task)

Декларативная проекция JSON `ai.task` на ODA-views ([`rules/rules.md`](/rules/rules.md/~/handlers/pages/form/) Part B: один `data`, геттеры, `$pdp`).

## 1. Что это

Shell + `ui/`: лента блоков и промптбар. Источник правды — `data` файла; дети получают `:data` / `:$item`.

## 2. Зачем это нужно

Показать дерево задачи и дать пользователю писать промпты, принимать plan/form и останавливать стрим — без знания внутренностей PIPE.

## 3. Как это работает

- Shell: `streamTarget` = focused без `content`/`html`; `streamingText` на delta; `streaming` true на `streamTarget` / delta, false на done; `changed`/`chat.done` → `load()`.
- Панель: `pending` (вертушка/стоп) — send и `chat.delta`; `chat.done` гасит сразу. Между шагами auto-loop `chat.done` нет.
- `focusedBlock` — последний не-`hidden` в живой ветке (`content` / без `items` — стоп спуска).
- `pinned` — авто-open у `focusedBlock` и предков на пути к нему. Сосед / закрытая площадка не на пути — сворачивается свободно.
- Топ-лента (`microchat-ribbon` + `$item`): scroll follow только при `stickBottom`; уход вверх отменяет pending `pinBottom`.
- Action-bar: `role:'APPROVE'`; скрыт при `$pdp.streamTarget`; зелёная — `accept: true` (+ для form `prompt` = JSON `$pdp.result`); крестик — `accept: false` (в query не уходит, сервер считает отказом).
- Шапка блока: скрыта только при `stop === true` (конец ветки); строка-`stop` (planning/form/complete) шапку не прячет. В шапке `data.state` — суть своей зоны (`2/2 Сайт` у web, `1 Интернет` у обзора), не фаза.
- Вид блока: `showTitle` — `color-mode: light`, тело `xx-small`; иначе (`stop: true`) — `content`, шрифт `small`. Пока стрим на блоке — `oda-markdown-viewer` тоже `xx-small`. `prompt` по-прежнему `info-invert`.
- Полоска слева у тела — только контейнер (`:host([container])`, `data.items` — массив).
- Form-слот: колонка (`--vertical`); fieldset `max-width: 400px`; default `microchat-form` рисует `data.html`. Поле ввода у «Другое» скрыто, пока пункт не выбран.
- Html-слот: `microchat-html` — `iframe[srcdoc]` + sandbox (`allow-scripts`); высота по `postMessage`.
- `site` — обычный блок: `label` = url, тело = `content` (обзор страницы). `data.url` есть у слота.

## 4. Из чего это состоит

```
$class.js      ← shell: data, focusedBlock, streamTarget, result, streamingText, streaming
ui/views.js    ← microchat-ribbon + microchat-view-* + microchat-form (shell import)
ui/ribbon.js   ← дубль ribbon (scroll-контракт; shell не импортирует)
ui/panel.js    ← microchat-panel (+ mic/tts/usage)
ui/mic.js      ← MicAudioController
ui/tts.js      ← TtsController
ui/usage.js    ← buildUsageStats / fmtTokens
```

| Модуль | Факт |
|--------|------|
| [`class.js`](class.js) | Shell: `streamTarget` / `streaming` / `streamingText`; delta/done. |
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
- **Action:** `actionButton` = строка `focusedBlock.stop`, но `null` пока `$pdp.streamTarget`; `sendAction(accept)` шлёт `accept` и для form — JSON `$pdp.result`.
- **Form:** слот только при `html`; `result` — снимок контролов; оболочка пробрасывает `view.result` → `$pdp.result`.
- **Html:** `block.html` → SPA в `iframe srcdoc` (sandbox); без APPROVE, конец ветки (`stop`).
- **Pinned:** авто-open у `focusedBlock` и предков на спуске. Не на пути — стрелка свободная.
- **Stream:** `streamTarget` = focused без тела. `typeIcon`: `spinners:3-dots-scale` на нём и на контейнерах над ним; в JSON не пишется. `streamingText` на delta. Панель: `pending` на send/`chat.delta`, гашение на `chat.done`; `fetch('stop')` → `_stopped`.
- **Load:** `$item.load()` в shell на set / changed / chat.done.
