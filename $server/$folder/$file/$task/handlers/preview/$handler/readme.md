# Preview микрочата (ai.task)

Декларативная проекция JSON `ai.task` на ODA-views по [`rules/rules.md`](/rules/rules.md/~/handlers/pages/form/) Part B (B.1.1–B.1.3).

## Принцип

Shell: `data` / `items` / `focusedBlock` / `streamingText` / load. Дети в `ui/`. Action и лента читают фокус через `$pdp` / дерево `items`.

```
$handler/class.js          ← вход + focusedBlock + streamingText
$handler/ui/*              ← ribbon, panel, views, mic, tts, usage
```

## Состав

| Модуль | Владеет |
|--------|---------|
| [`class.js`](class.js) | shell: `data`/`items`/`focusedBlock`/`streamingText`, load по `changed` |
| [`ui/ribbon.js`](ui/ribbon.js) | лента; top=`!!$item`; scroll на attached/delta/done |
| [`ui/panel.js`](ui/panel.js) | composer, files, `data.model`, action (`$pdp.focusedBlock?.button`); pending + send/stop |
| [`ui/mic.js`](ui/mic.js) | speech recognition |
| [`ui/tts.js`](ui/tts.js) | TTS (browser / piper) |
| [`ui/usage.js`](ui/usage.js) | dial контекста |
| [`ui/views.js`](ui/views.js) | блоки; open = last в слое; tip рисует `$pdp.streamingText` |

## Контракты UI

- **Модель** всегда в `data.model` — не искать в MODELS из panel.
- **Action:** `focusedBlock.button` → `value = label` → `send()`. Геттер без `|| null`.
- **Стили статуса:** attrs `success`/`warning`/`error`, не `.btn-*`.
- **Stream:** delta → shell `streamingText`; tip-view `viewContent` + boolean `showContent`; ribbon только scroll. Stop/resume: `$item.fire('chat.stop'|'chat.resume')`.
- **`$pdp` + Reactor:** см. rules B.1.2 (`Reactor.get` в proxy; не кэшировать `null`).

## Pending (panel)

- `send()` → `pending = true`
- `chat.done` / `stop` → `pending = false`

## Load

`$task.contentType = 'application/json'` → object; shell: `this.data = await $item.load()`.
