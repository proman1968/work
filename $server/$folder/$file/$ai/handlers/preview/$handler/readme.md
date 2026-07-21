# Preview микрочата (task.ai)

Визуализатор файла `.ai` по схеме [`$ai/class.js`](/$server/$folder/$file/$ai/class.js/~/handlers/pages/form/).

## Состав

| Модуль | Назначение |
|--------|------------|
| `microchat-ribbon` | лента блоков `ribbon[]` |
| `microchat-streaming` | стриминг ответа |
| `microchat-panel` | actions / input / settings |

## Контракт type → view

`type` блока = суффикс компонента: `microchat-view-<type>`.

| type | компонент |
|------|-----------|
| `prompt` | `microchat-view-prompt` |
| `thinking` | `microchat-view-thinking` |
| `text` | `microchat-view-text` |
| `action` | `microchat-view-action` — MD + `title` (План/Отчёт/Действие); **без fields**; кнопка на панели |
| `form` | `microchat-view-form` — MD + `fields` (ввод данных); кнопка на панели |
| `questions` | `microchat-view-questions` — MD + `fields` (опросник); кнопка на панели |
| `task` | `microchat-view-task` (план + steps + вложенный ribbon) |
| `file` | `microchat-view-file` |
| `tool` | `microchat-view-tool` |
| `tool_result` | `microchat-view-tool_result` |
| `error` | `microchat-view-error` |

Открытый interactive = последний `action`|`form`|`questions` без последующего `prompt`. Кнопка панели шлёт `{ text: label, confirm: true, answers? }`.

`task` появляется после prompt-принятия плана. В `task.ribbon` — исполнение (thinking / action с fields / tools).

## Legacy-адаптер

При рендере старых файлов:

- `role:'user'` → `prompt`
- `details` / `reasoning` → `thinking`
- `block` → `task`
- `form` / `questions` → `action` + `fields`
- `text` + `error` → `error`

## Состояние

- ✅ схема TYPES в `$ai/class.js`
- ✅ visualizers + ribbon/panel/streaming
- ✅ harness пишет новые type; action = MD; стоп до confirm
- ✅ questions answered-режим; select как варианты (radio-стиль)
- ✅ контракт ролей/контекста — в [`$ai/readme.md`](/$server/$folder/$file/$ai/readme.md/~/handlers/pages/form/)
