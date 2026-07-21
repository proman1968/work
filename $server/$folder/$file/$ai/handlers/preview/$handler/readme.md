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
| `action` | `microchat-view-action` — MD + опционально `fields` (метамодель); **кнопка только на панели** |
| `task` | `microchat-view-task` (план + steps + вложенный ribbon) |
| `file` | `microchat-view-file` |
| `tool` | `microchat-view-tool` |
| `tool_result` | `microchat-view-tool_result` |
| `error` | `microchat-view-error` |

`action` — предложение: `content` (MD), опционально `fields[]` (id/label/type/options/value), `button`. Открытый = последний action без последующего `prompt`. Кнопка панели шлёт `{ text: label, confirm: true, answers? }`.

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
