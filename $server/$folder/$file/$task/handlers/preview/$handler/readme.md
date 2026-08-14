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
- Action-bar: `role:'APPROVE'`; скрыт при `$pdp.streaming`; form → JSON values; иначе `true`/`false`.
- Form-слот: 100% ширины ленты; default `microchat-form` (flex-wrap); `data.ui` → другой CE.
- Html-слот: `microchat-html` — `iframe[srcdoc]` + sandbox (`allow-scripts`); высота по `postMessage`.

## 4. Из чего это состоит

```
$class.js      ← shell: data, focusedBlock, streamingText, streaming
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
| [`ui/panel.js`](ui/panel.js) | `actionButton` читает `$pdp.streaming` + `button` (сброс кэша геттера). APPROVE; form → JSON values. |
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

- **Модель:** `data.model` → `WORK.get_item`; смена — picker `/MODELS` + `fetch('change_model')`.
- **Action:** `actionButton` = `focusedBlock.button`, но `null` пока `$pdp.streaming`; form — JSON `values`; иначе `true`/`false`.
- **Form:** слот на ширину ленты; `fields`/`values` после parse; опционально `ui`; сдача APPROVE.
- **Html:** `block.html` → SPA в `iframe srcdoc` (sandbox); без APPROVE, конец ветки (`stop`).
- **Stream:** shell `streaming` + `streamingText`; view через `$pdp`; ribbon скроллит при stick.
- **Load:** `$item.load()` в shell на set / changed / chat.done.
