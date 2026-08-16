# Preview микрочата (ai.task)

Декларативная проекция JSON `ai.task` на ODA-views ([`rules/rules.md`](/rules/rules.md/~/handlers/pages/form/) Part B: один `data`, геттеры, `$pdp`).

## 1. Что это

Shell + `ui/`: лента блоков и промптбар. Источник правды — `data` файла; дети получают `:data` / `:$item`.

## 2. Зачем это нужно

Показать дерево задачи и дать пользователю писать промпты, принимать plan/form и останавливать стрим — без знания внутренностей PIPE.

## 3. Как это работает

- Shell: `streamingText` на delta; `streaming` true на каркасе wait / delta, false на done; `changed`/`chat.done` → `load()`.
- `focusedBlock` — последний не-`hidden` в открытой ветке (`closed` / без `items` — стоп спуска).
- Топ-лента (`microchat-ribbon` + `$item`): scroll follow только при `stickBottom`; уход вверх отменяет pending `pinBottom`.
- Action-bar: `role:'APPROVE'`; скрыт при `$pdp.streaming`; зелёная — `accept: true` (+ для form `prompt` = JSON `$pdp.result`); крестик — `accept: false` (в query не уходит, сервер считает отказом).
- Шапка блока: скрыта только при `stop === true` (конец ветки); строка-`stop` (planning/form/complete) шапку не прячет.
- Form-слот: колонка (`--vertical`); fieldset `max-width: 400px`; default `microchat-form` рисует `data.html`.
- Html-слот: `microchat-html` — `iframe[srcdoc]` + sandbox (`allow-scripts`); высота по `postMessage`.

## 4. Из чего это состоит

```
$class.js      ← shell: data, focusedBlock, result, streamingText, streaming
ui/views.js    ← microchat-ribbon + microchat-view-* + microchat-form (shell import)
ui/ribbon.js   ← дубль ribbon (scroll-контракт; shell не импортирует)
ui/panel.js    ← microchat-panel (+ mic/tts/usage)
ui/mic.js      ← MicAudioController
ui/tts.js      ← TtsController
ui/usage.js    ← buildUsageStats / fmtTokens
```

| Модуль | Факт |
|--------|------|
| [`class.js`](class.js) | Shell: `streaming` / `streamingText`; каркас wait → `streaming`; delta/done. |
| [`ui/views.js`](ui/views.js) | Ribbon + views. Form-слот / html-iframe. Scroll: `stickBottom`. |
| [`ui/ribbon.js`](ui/ribbon.js) | Черновик/дубль ленты. |
| [`ui/panel.js`](ui/panel.js) | `actionButton` = строка `focusedBlock.stop` (нет при streaming). APPROVE: `accept` + для form `prompt` = JSON `$pdp.result`. |
| [`ui/mic.js`](ui/mic.js) | SpeechRecognition → `panel.value` / `recording` / `timer`. |
| [`ui/tts.js`](ui/tts.js) | `off` / `local` / `browser`; delta → speak на done. |
| [`ui/usage.js`](ui/usage.js) | Usage из `data.usage` + walk `data.items`. |

## 5. В каком это состоянии

- ✅ Лента, stream, stick-scroll; form/html; action-bar скрыт при `streaming`
- 🔧 Кастомные `data.ui` у form — CE по желанию
- 🔧 `ui/ribbon.js` не в load-path shell

## 6. Дальнейшие планы

- Один источник ribbon
- Примеры кастомных `microchat-form-*` под `data.ui`

## Контракты (как в коде)

- **Модель:** `data.model` → `WORK.get_item`; смена — picker `/MODELS` + `fetch('change_model', { model: path })`.
- **Action:** `actionButton` = строка `focusedBlock.stop`, но `null` пока `$pdp.streaming`; `sendAction(accept)` шлёт `accept` и для form — JSON `$pdp.result`.
- **Form:** слот рисует `html`; `result` — снимок контролов; оболочка пробрасывает `view.result` → `$pdp.result`.
- **Html:** `block.html` → SPA в `iframe srcdoc` (sandbox); без APPROVE, конец ветки (`stop`).
- **Stream:** shell `streaming` + `streamingText`; view через `$pdp`; `typeIcon` на стримящемся блоке — `spinners:3-dots-scale`; ribbon скроллит при stick.
- **Load:** `$item.load()` в shell на set / changed / chat.done.
