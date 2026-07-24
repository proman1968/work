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

Tip-кнопки — **над** полем «Сообщение…» в `microchat-panel`, не внутри карточек ленты.

- `open` / tip = **последний** блок исполняемой ветки, если у него есть `button.label`. Не зависит от `answered`.
- Ветка tip: `active` task → его `ribbon` (включая step-prompt / questions / Отчёт); иначе task с button на хвосте ribbon; иначе корень (`action` «План»).
- Primary → `prompt` с текстом `button.label` (+ `answers?` из `fields` формы/опроса).
- Cancel (X) → `prompt` с текстом `нет`.
- Можно ввести тот же текст вручную в composer.
- Trust `pendingAction` — отдельная панель «Подтвердить» (как раньше).

## Модель

- В **form chat** (нет получателей) выбор нейросети в AI-режиме промпт-бара → поле `model` в создаваемом `task.ai`.
- `on_save` не затирает клиентский `model` (`body.model || findFirstModel()`).
- В preview смена модели через `item-node` / `/MODELS` пишет в `data.model` (источник правды для задачи).

## TTS

- Цикл: `off → local → browser` (`ttsMode` без `$save`, дефолт всегда `off`).
- `local` = **Piper** (`POST $item?tts` → `/MODELS/Local/Piper`, порт **8003**); fallback browser.
- Готовность: `GET /health` → `model_loaded`; `?start` → `piper_start.bat` (голос `ru_RU-irina-medium`).
- Qwen3 остаётся в `/MODELS/Local/Qwen3-TTS` (:8002) для ручного `?tts`.
- Текст в `_ttsBuffer`; speak на `chat.done`.

## Pending (ИИ работает)

- Слот mic = `av:stop` + `:rainbow="pending"` → `stopGeneration()`; радуга только на кнопке (`:rainbow`, не голый атрибут).
- Stop → `prompt { stop: true }` + серверный abort текущего цикла; `task` / `pendingPlan` не отменяются.
- После Stop UI игнорирует `chat.delta` (`_userStopped`), пока не будет новый `send` / `confirm`.
- Первый ход после `on_save` (без `send`): `pending` по эвристике «есть prompt, нет ответа AI» + на `chat.delta`.
- В ленте при стриме — только текст токенов (без панели «Думаю/Генерирую»).
- `_reload` / mid-loop `changed` не сбрасывает `pending` (только `chat.done` / Stop / error).

## Legacy

`migrateRibbon` один раз на load (`role→prompt`, `block→task`, `answered` по следующему prompt). Не в render path.

## Состояние

- ✅ `data` / `:data` / getters (не `~props`)
- ✅ `microchat-view-file`: `path` и `$item` из `data`
- ✅ task = nested ribbon
- ✅ Ask = questions + field
- ✅ модель из form chat → `task.ai.model`
- ✅ TTS local = Piper; pending → Stop+rainbow только в слоте mic
