# Preview микрочата (ai.task)

Декларативная проекция JSON `ai.task` на ODA-views ([`rules/rules.md`](/rules/rules.md/~/handlers/pages/form/) Part B: один `data`, геттеры, `$pdp`).

## Что это

Shell (`class.js`) + `ui/`: лента блоков и промптбар. Источник правды — `data` файла; дети получают `:data` / `:items` / `:$item`.

```
$class.js                 ← shell: data, items, focusedBlock, streamingText, load
ui/views.js               ← ODA-views блоков (+ import ribbon)
ui/ribbon.js              ← microchat-ribbon
ui/panel.js               ← microchat-panel (+ mic/tts/usage)
ui/mic.js                 ← MicAudioController (только panel)
ui/tts.js                 ← TtsController (только panel)
ui/usage.js               ← buildUsageStats / fmtTokens (только panel)
```

## Состав

| Модуль | Факт |
|--------|------|
| [`class.js`](class.js) | Шаблон: `microchat-ribbon` + `microchat-panel`. `$item.set`: `changed` / `chat.done` → `streamingText=''` + `load()`; `chat.delta` → накопление `streamingText`. `focusedBlock` — последний не-`hidden` в открытой ветке (`closed` / без `items` — стоп). |
| [`ui/ribbon.js`](ui/ribbon.js) | `top = !!$item` (attr). Рендер: `tag(item)` → `microchat-view-{type}` если CE/`ODA.telemetry`, иначе `microchat-view`; скрывает `hidden`. Scroll только у топа: `pinBottom` / `attached` / `items.set`; на `chat.delta` — follow если `nearBottom`; на `chat.done` — `scrollToBottom`. |
| [`ui/panel.js`](ui/panel.js) | Composer, files, dial usage, TTS cycle, model picker. `actionButton = $pdp.focusedBlock?.button`. Action-bar: `sendAction(true\|false)` → `fetch('prompt', { prompt: ok, role: 'BUTTON', model })`. `send()` → текст/файлы → `fetch('prompt', …)`; пустой send → mic. `stop()` → `fetch('stop')`. Pending: true на send/sendAction; false на `chat.done` / `stop` / `chat.error` / `result.ok === false`. |
| [`ui/views.js`](ui/views.js) | База `microchat-view`: `open = hideTitle \|\| pinned \|\| userOpen`; `pinned = Reactor.equal(host.items.last, data)`. Stream: `streamTail` только если блок = `$pdp.focusedBlock`; `viewContent = content + streamTail`; `showContent` — boolean. Типы: `prompt`, `step`, `form` (+ stub `microchat-form`), `answer`/`question`/`research` (`hideTitle`), `task` (+ `microchat-task-todo`). |
| [`ui/mic.js`](ui/mic.js) | SpeechRecognition → `panel.value` / `recording` / `timer`. |
| [`ui/tts.js`](ui/tts.js) | Режимы `off` / `local` / `browser`; буфер delta → speak на done. |
| [`ui/usage.js`](ui/usage.js) | Статистика контекста из `data.usage` + walk `data.items`. |

## Контракты (как в коде)

- **Модель:** чтение `data.model` → `WORK.get_item`; смена — picker `/MODELS` + `fetch('change_model')`. Гидрации «найти модель в MODELS, если пусто» нет.
- **Action:** видимость по `actionButton?.label`; yes/no → `sendAction(true|false)`, не `value = label` и не `send()`.
- **Статусы кнопок:** attrs `success-invert` / `warning` / `error-invert` на action-bar.
- **Stream:** shell копит `streamingText`; view читает через `$pdp`; ribbon только скроллит.
- **`$pdp` / Reactor:** `actionButton` и `streamTail` через `$pdp`; `pinned` через `Reactor.get` / `Reactor.equal`; пусто без `|| null`.

## Load

`$item.load()` в shell (`$item.set`, `changed`, `chat.done`). Тип тела — контракт `$task` / `$file.load` (JSON → object).
