# Preview микрочата (ai.task)

Декларативная проекция JSON `ai.task` на ODA-views по [`rules/rules.md`](/rules/rules.md/~/handlers/pages/form/) Part B.

## Принцип

Shell абстрактен: лента + промптбар. Компоненты инкапсулированы; связь — биндинг `:data` / `:items` / `:$item`.

Эталон канона: [`rules/rules.md`](/rules/rules.md/~/handlers/pages/form/) **B.1.1** (shell preview).

```
shell
  → microchat-ribbon :items :$item
  → microchat-panel  :data :$item
```

## Состав

| Модуль | Владеет |
|--------|---------|
| [`class.js`](class.js) | shell: `data`/`items`/`$item`, load по `changed` |
| [`ribbon.js`](ribbon.js) | лента, scroll, live-stream |
| [`panel.js`](panel.js) | tip, composer, mic/TTS/model; `pending` + `send`/`stop` |
| [`views.js`](views.js) | блоки; `answers` у формы |

## Tip-кнопки

`value = button.label` → обычный `send()` (пока пишется в ленту как prompt).

## Pending (panel)

- `send()` → `pending = true`
- `chat.done` / `stop` → `pending = false`

## Load

`$task.contentType = 'application/json'` → http-server / `WORK.fetch` отдают объект; shell: `this.data = await $item.load()`.
