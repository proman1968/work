# Preview микрочата (ai.task)

Декларативная проекция JSON `ai.task` на ODA-views по [`rules/rules.md`](/rules/rules.md/~/handlers/pages/form/) Part B.

## Принцип

Shell абстрактен: лента + промптбар. Компоненты инкапсулированы; связь — биндинг `:data` / `:items` / `:$item`.

Эталон канона: [`rules/rules.md`](/rules/rules.md/~/handlers/pages/form/) **B.1.1** (shell preview).

```
$handler/class.js          ← вход
$handler/ui/*              ← ribbon, panel, views, mic, tts, usage
```

## Состав

| Модуль | Владеет |
|--------|---------|
| [`class.js`](class.js) | shell: `data`/`items`/`$item`/`focusedBlock`, load по `changed` |
| [`ui/ribbon.js`](ui/ribbon.js) | лента, scroll, live-stream |
| [`ui/panel.js`](ui/panel.js) | composer, files, model (`data.model`), action (`$pdp.focusedBlock`); `pending` + `send`/`stop` |
| [`ui/mic.js`](ui/mic.js) | speech recognition |
| [`ui/tts.js`](ui/tts.js) | TTS (browser / piper) |
| [`ui/usage.js`](ui/usage.js) | dial контекста из `data.usage` / блоков |
| [`ui/views.js`](ui/views.js) | блоки; `answers` у формы |

## Action-кнопка

`focusedBlock.button.label` → `value` → `send()`.

## Pending (panel)

- `send()` → `pending = true`
- `chat.done` / `stop` → `pending = false`

## Load

`$task.contentType = 'application/json'` → http-server / `WORK.fetch` отдают объект; shell: `this.data = await $item.load()`.
