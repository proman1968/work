# Preview микрочата (task.ai)

Декларативная проекция JSON `task.ai` на ODA-views по [`rules/rules.md`](/rules/rules.md/~/handlers/pages/form/) Part B.

## Принцип

```
data (JSON) → get items → microchat-ribbon :items
  → ~for → :data="$for.item" → microchat-view-* (extends microchat-view)
  → getters от data → UI
```

Один `data` в памяти. Корень и вложенность — поле `items`. Harness / WS мутируют JSON — Reactor рисует. Без `~props`.

## Состав

| Модуль | Назначение |
|--------|------------|
| shell (`export default`) | `data`, `get items`, load/WS, confirm/send, model, mic/TTS |
| `microchat-ribbon` | `~for` + `~is` + `:data` |
| `microchat-panel` | composer |
| [`views.js`](views.js) | `microchat-view` + `microchat-view-*` + `microchat-field` (`import './views.js'` в class.js) |

## Контракт type → view

| type | компонент |
|------|-----------|
| `prompt` | `extends: 'microchat-view'`; `--info-invert`, аватар/время, без chevron, всегда open; summary = текст сообщения |
| `thinking` | `microchat-view-thinking` |
| `text` | `microchat-view-text` |
| `action` | `microchat-view-action` |
| `form` / `questions` | fields через `microchat-field` |
| `task` | `extends: 'microchat-view'`; todo через `bodyTag` → `microchat-task-todo` (чеклист `steps`); ribbon `items` из базы |
| `file` | `get path` / `get $item` → `item-node` |
| `tool` / `tool_result` / `error` | соответствующие view |

## Panel

Tip-кнопки — **над** полем «Сообщение…» в `microchat-panel`.

Кнопка контекста (кружок %) — всегда в toolbar; по клику — панель: % / used·limit / сегменты (System, Диалог, Ответы) из `data.usage` и суммы usage по дереву `items`.

## Модель

- Form chat → `model` в создаваемом `task.ai`.
- Preview: смена модели → `fetch('change_model')` → `body.model`.

## TTS

- Цикл: `off → local → browser`.
- `local` = Piper (`POST $item?tts`).
- Speak на `chat.done`.

## Pending

- Mic-слот = Stop + rainbow при `pending`.
- Первый ход: эвристика «есть prompt, нет ответа AI».

## Состояние

- ✅ `data` / `:data` / getters
- ✅ корень `items` (не `ribbon`)
- ✅ views в `views.js` через `~/views`
- ✅ task nested `items`
