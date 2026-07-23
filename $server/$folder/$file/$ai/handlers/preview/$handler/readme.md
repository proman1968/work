# Preview микрочата (task.ai)

Декларативная проекция JSON `task.ai` на ODA-views по [`rules/rules.md`](/rules/rules.md/~/handlers/pages/form/) Part B.

## Принцип

```
data (JSON) → get items → microchat-ribbon :items
  → ~for → :data="$for.item" → microchat-view-* (extends microchat-view)
  → getters от data → UI
```

Один `data` в памяти. Harness / WS мутируют JSON — Reactor рисует. Без `~props`.

## Состав

| Модуль | Назначение |
|--------|------------|
| shell (`export default`) | `data`, `get items`, load/WS, confirm/send, model, mic/TTS |
| `microchat-ribbon` | `~for` + `~is` + `:data` |
| `microchat-panel` | composer |
| `microchat-view` | база: `data: null` |
| `microchat-view-*` | геттеры от `data` |
| `microchat-field` | `:field` = объект из `data.fields` |

## Контракт type → view

| type | компонент |
|------|-----------|
| `prompt` | `microchat-view-prompt` |
| `thinking` | `microchat-view-thinking` |
| `text` | `microchat-view-text` |
| `action` | `microchat-view-action` |
| `form` / `questions` | fields через `microchat-field` |
| `task` | steps + nested ribbon `:items` от `data.ribbon` |
| `file` | `get path` / `get $item` → `item-node` |
| `tool` / `tool_result` / `error` | соответствующие view |

## Panel

`open` = последний unanswered `action`|`form`|`questions` (в т.ч. в `task.ribbon`).  
`confirm(true)` → `{ text: button.label, confirm: true, answers? }` из `fields` на том же блоке `data`.

## Модель

- В **form chat** (нет получателей) выбор нейросети в AI-режиме промпт-бара → поле `model` в создаваемом `task.ai`.
- `on_save` не затирает клиентский `model` (`body.model || findFirstModel()`).
- В preview смена модели через `item-node` / `/MODELS` пишет в `data.model` (источник правды для задачи).

## Legacy

`migrateRibbon` один раз на load (`role→prompt`, `block→task`, `answered` по следующему prompt). Не в render path.

## Состояние

- ✅ `data` / `:data` / getters (не `~props`)
- ✅ `microchat-view-file`: `path` и `$item` из `data`
- ✅ task = nested ribbon
- ✅ Ask = questions + field
- ✅ модель из form chat → `task.ai.model`
