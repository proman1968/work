# Preview микрочата (task.ai)

Декларативная проекция [`TYPES`](/$server/$folder/$file/$ai/class.js/~/handlers/pages/form/) на ODA-views.

## Принцип

```
body.ribbon[]  →  ~for  →  ~is microchat-view-<type>  +  ~props block
```

Один `body` в памяти. Harness / WS мутируют — Reactor рисует. Без `normalizeRibbon` на render, без `:item` / sync / `openAsk`.

## Состав

| Модуль | Назначение |
|--------|------------|
| shell (`export default`) | load, WS, `open` / `confirm` / `send`, model, mic/TTS |
| `microchat-ribbon` | `~for` + `~is` + `~props` |
| `microchat-panel` | кнопка openInteractive + input |
| `microchat-view-*` | props = поля TYPES |
| `microchat-field` | одно поле Ask; `:field` = объект из `body` |

## Контракт type → view

| type | компонент |
|------|-----------|
| `prompt` | `microchat-view-prompt` |
| `thinking` | `microchat-view-thinking` |
| `text` | `microchat-view-text` |
| `action` | `microchat-view-action` — MD + title; кнопка на панели |
| `form` / `questions` | fields через `microchat-field`; кнопка на панели |
| `task` | steps + nested `<microchat-ribbon :items="ribbon">` |
| `file` / `tool` / `tool_result` / `error` | соответствующие view |

`task` не особый случай: вложенный `ribbon` снова проходит тот же диспетч — Ask внутри task = обычный `microchat-view-questions`.

## Panel

`open` = последний unanswered `action`|`form`|`questions` (в т.ч. в `task.ribbon`).  
`confirm(true)` → `{ text: button.label, confirm: true, answers? }` из тех же `fields` на `body`.

## Legacy

`migrateRibbon` один раз на load (`role→prompt`, `block→task`, `answered` по следующему prompt). Не в render path.

## Состояние

- ✅ `~is` + `~props` = TYPES
- ✅ task = nested ribbon
- ✅ Ask = `microchat-view-questions` + `microchat-field`
- ✅ один `open` / `confirm` / `send`
