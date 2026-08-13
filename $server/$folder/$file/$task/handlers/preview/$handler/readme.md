# Preview микрочата (ai.task)

Декларативная проекция JSON `ai.task` на ODA-views ([`rules/rules.md`](/rules/rules.md/~/handlers/pages/form/) Part B: один `data`, геттеры, `$pdp`).

## 1. Что это

Shell + `ui/`: лента блоков и промптбар. Источник правды — `data` файла; дети получают `:data` / `:$item`.

## 2. Зачем это нужно

Показать дерево задачи и дать пользователю писать промпты, принимать plan/form и останавливать стрим — без знания внутренностей PIPE.

## 3. Как это работает

- Shell копит `streamingText` на `chat.delta`; на `changed` / `chat.done` — `load()` в `data`.
- `focusedBlock` — последний не-`hidden` в открытой ветке (`closed` / без `items` — стоп спуска).
- Топ-лента (`microchat-ribbon` + `$item`): scroll follow только при `stickBottom`; уход вверх отменяет pending `pinBottom`.
- Action-bar: `role:'APPROVE'`; form → `JSON.stringify(block.values)`; иначе `true`/`false`.

## 4. Из чего это состоит

```
$class.js      ← shell: data, items, focusedBlock, streamingText
ui/views.js    ← microchat-ribbon + microchat-view-* + microchat-form (shell import)
ui/ribbon.js   ← дубль ribbon (scroll-контракт; shell не импортирует)
ui/panel.js    ← microchat-panel (+ mic/tts/usage)
ui/mic.js      ← MicAudioController
ui/tts.js      ← TtsController
ui/usage.js    ← buildUsageStats / fmtTokens
```

| Модуль | Факт |
|--------|------|
| [`class.js`](class.js) | `microchat-ribbon` + `microchat-panel`. Listen: `changed`/`chat.done` → reload; `chat.delta` → `streamingText`. |
| [`ui/views.js`](ui/views.js) | Ribbon + views. Scroll: `stickBottom` / `pinBottom(true)` только open. `microchat-form`: поля → `data.values`. Stream: `streamTail` если блок = `$pdp.focusedBlock`. |
| [`ui/ribbon.js`](ui/ribbon.js) | Черновик/дубль ленты. |
| [`ui/panel.js`](ui/panel.js) | Composer, files, usage dial, TTS, model picker. `sendAction` → APPROVE; form → JSON values. |
| [`ui/mic.js`](ui/mic.js) | SpeechRecognition → `panel.value` / `recording` / `timer`. |
| [`ui/tts.js`](ui/tts.js) | `off` / `local` / `browser`; delta → speak на done. |
| [`ui/usage.js`](ui/usage.js) | Usage из `data.usage` + walk `data.items`. |

## 5. В каком это состоянии

- ✅ Лента, stream, stick-scroll, form values → APPROVE
- 🔧 `oda-form` не подключён — свой `microchat-form`
- 🔧 `ui/ribbon.js` не в load-path shell

## 6. Дальнейшие планы

- Один источник ribbon (убрать дубль или импортировать)
- При необходимости заменить поля на `oda-form`

## Контракты (как в коде)

- **Модель:** `data.model` → `WORK.get_item`; смена — picker `/MODELS` + `fetch('change_model')`.
- **Action:** `actionButton?.label`; form — JSON `values`; иначе `true`/`false` (`role: 'APPROVE'`).
- **Form:** блок уже с `fields`/`values` после `PIPE.form.parse` на сервере; UI только пишет `values`.
- **Stream:** shell `streamingText`; view через `$pdp`; ribbon скроллит при stick.
- **Load:** `$item.load()` в shell на set / changed / chat.done.
