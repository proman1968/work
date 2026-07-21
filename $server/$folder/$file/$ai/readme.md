# task.ai — файл агента ИИ

## Что это

`$ai` — тип файла для хранения диалога с ИИ-агентом. Каждый `.ai` файл — это JSON, представляющий ленту (ribbon) взаимодействия пользователя с ИИ. Цель — функционал полного цикла, аналогичный Cline/Cursor: автоматическое выполнение любых доступных задач через tool-calling.

## Зачем это нужно

Единый формат данных для:
- **Сервера** — метод `prompt` читает `ribbon`, строит messages для LLM, выполняет tool-calls, пишет результаты обратно
- **Клиента** — preview handler отображает `ribbon` как микрочат с интерактивными элементами
- **Агента** — может рекурсивно создавать вложенные `task` со своими лентами

## Как это работает

### Принципы формата

1. **Унификация через `type`** — каждый блок в ribbon идентифицируется полем `type`. Нет двойной модели `role` + `type`.
2. **Рекурсивность** — `task` содержит свой `ribbon`, в котором могут быть любые блоки, включая вложенные `task`.
3. **Подтверждение через `action` / `questions`** — trailing gate: последний нерешённый блок → кнопка в панели. Нажатие OK/Отмена = обычный `prompt` (текст = label / «Отмена») + `confirm`. `questions` открывает форму после кнопки (не сразу в ленте).
4. **PDCA-цикл** — `task` содержит `plan` (намерение) и `ribbon` (выполнение). Статусы плана синхронизируются по мере выполнения.
5. **Режимы** — `ADMIN` / `BOSS` / `USER` задают политику агента в system prompt (полный развод tools — позже).

---

## Структура файла (верхний уровень)

```json
{
  "system": "string — system prompt (заполняется триггером on_save)",
  "model": "/models/... — путь к выбранной модели $ai",
  "mode": "USER",
  "ribbon": [],
  "maxIterations": 10
}
```

| Поле | Тип | Описание |
|---|---|---|
| `system` | string | System prompt для LLM. Заполняется триггером `on_save` при первом сохранении. |
| `model` | string | Путь к элементу-модели (например `/models/GigaChat/GigaChat Light`). |
| `mode` | string | Режим агента: `ADMIN` (развитие платформы), `BOSS` (бизнес/проекты), `USER` (рутина). Default `USER`. |
| `ribbon` | array | Главная лента диалога — массив блоков. |
| `maxIterations` | number | Лимит итераций tool-call цикла (по умолчанию 10). |

**Transient-поля** (генерируются сервером в `prompt` на лету, НЕ хранятся в файле): `context`, `mem`, `readme`.

---

## Типы блоков ribbon

### Общие поля (обязательные)

| Поле | Тип | Назначение |
|---|---|---|
| `type` | string | Тип блока (из списка ниже) |
| `time` | number | Timestamp создания (миллисекунды) |

### Общие поля (опциональные)

| Поле | Тип | Назначение |
|---|---|---|
| `sender` | string | Автор: `'user'` для человека, путь модели для ИИ, `'system'` |
| `error` | boolean | Флаг ошибки |

---

### `prompt` — запрос пользователя

Сообщение от пользователя.

```json
{
  "type": "prompt",
  "time": 1784486745000,
  "sender": "user",
  "content": "Создай презентацию",
  "files": []
}
```

| Поле | Тип | Описание |
|---|---|---|
| `content` | string | Текст запроса |
| `files` | array | Прикреплённые файлы (опционально) |

---

### `text` — текстовый ответ ИИ

Ответ ИИ в свободной форме (markdown).

```json
{
  "type": "text",
  "time": 1784486745100,
  "sender": "/models/GigaChat/GigaChat Light",
  "content": "Я создам презентацию. Вот план...",
  "error": false
}
```

| Поле | Тип | Описание |
|---|---|---|
| `content` | string | Текст ответа (markdown) |
| `error` | boolean | Если true — сообщение об ошибке |

---

### `reasoning` — мысли ИИ

Внутренние рассуждения ИИ (не отправляются обратно в LLM). В UI отображаются свёрнутыми.

```json
{
  "type": "reasoning",
  "time": 1784486745200,
  "sender": "/models/...",
  "label": "Анализ задачи",
  "content": "Нужно проанализировать структуру..."
}
```

| Поле | Тип | Описание |
|---|---|---|
| `content` | string | Текст рассуждения |
| `label` | string | Заголовок (опционально, по умолчанию «Мысли») |

---

### `questions` — форма (trailing gate, как `action`)

Редкий структурированный ввод. Пока блок последний и не `answered`/`resolved` — в нижней панели кнопка (`action`, default «Заполнить»). В ленте до нажатия — карточка (title + content MD), **без** полей. После кнопки открывается форма (METADATA-поля; подключение `oda-layout-designer` — следующим шагом). Ответы уходят новым `prompt`.

Поля — как `METADATA.fields` в `$class` (`String` / `Text` / `Number` / `Boolean` / `DateTime` / `Select`).

```json
{
  "type": "questions",
  "time": 1784486745300,
  "sender": "/models/...",
  "title": "Параметры запуска",
  "content": "Нужны числа и сроки.",
  "action": "Заполнить",
  "color": "info",
  "fields": [
    { "id": "budget", "type": "Number", "label": "Бюджет", "required": true },
    { "id": "deadline", "type": "DateTime", "label": "Дедлайн", "required": true },
    { "id": "priority", "type": "Select", "label": "Приоритет", "options": ["low", "normal", "high"] },
    { "id": "notify", "type": "Boolean", "label": "Уведомлять" }
  ]
}
```

| Поле | Тип | Описание |
|---|---|---|
| `title` | string | Заголовок карточки |
| `content` | string | Пояснение (MD); остаточный текст ответа ИИ складывается сюда сервером |
| `action` | string | Надпись кнопки в панели |
| `color` | string | Цвет кнопки |
| `fields` | array | Описание полей (METADATA-like) |
| `answered` / `resolved` | boolean | Форма закрыта |

Legacy: ключ `questions` и типы `text`/`textarea`/`checkbox`… нормализуются на клиенте в `fields` + PascalCase.

---

### `tool_call` — вызов инструмента ИИ

Вызов метода контекста или сервиса (function calling).

```json
{
  "type": "tool_call",
  "time": 1784486745400,
  "sender": "/models/...",
  "method": "write_file",
  "args": { "name": "readme.md", "content": "..." }
}
```

| Поле | Тип | Описание |
|---|---|---|
| `method` | string | Имя вызываемого метода |
| `args` | object | Аргументы вызова |

---

### `tool_result` — результат вызова

Результат выполнения `tool_call`. В UI отображается свёрнутым.

```json
{
  "type": "tool_result",
  "time": 1784486745500,
  "sender": "/models/...",
  "tool": "write_file",
  "content": "{ \"success\": true, \"path\": \"/folder/readme.md\" }",
  "resultPath": "/folder/readme.md",
  "error": false
}
```

| Поле | Тип | Описание |
|---|---|---|
| `tool` | string | Имя метода, результат которого |
| `content` | string | Результат (строка или JSON-строка) |
| `resultPath` | string | Путь к созданному/изменённому файлу (опционально) |

---

### `action` — блок запроса подтверждения

Не кнопка сама по себе, а блок с описанием действия. Кнопка в active-панели микрочата появляется **только если `action` (или неотвеченный `questions`) — последний блок** в целевой ленте (основной ribbon или `task.ribbon` активной задачи).

Поля блока:

| Поле | Тип | Описание |
|---|---|---|
| `action` | string | Надпись кнопки в панели (из `label` тега). Обязательна. |
| `title` | string | Опционально. Заголовок карточки — **только явный** `title`, не копия `label`. |
| `content` | string | Опционально. Markdown описания. Вопрос да/нет — в предыдущем `text`, не в title. |
| `color` | string | Цвет кнопки: `success`, `error`, `info`, `warning` |
| `calls` | array | Служебное: отложенные tool-calls до подтверждения |
| `contextPath` | string | Служебное: путь контекста для `calls` |
| `resolved` | boolean | Служебное: подтверждение закрыто |

Пустой yes/no: `{ "type":"action", "action":"Да", "color":"success" }` — **без** `title`. Не писать `title:"Да"` + `action:"Да"` + пустой `content`.

**`plan` у `action` нет** — план только у `task`. При предложении плана шаги пишутся нумерованным списком в `content` (MD); при confirm («Начать» = prompt) сервер парсит их в `task.plan`, шаг 1 → `in_progress`, prompt кладётся в `task.ribbon`, далее фаза Do.

#### Канон: предложение плана (до confirm)

```json
{
  "ribbon": [
    { "type": "prompt", "content": "сделай презентацию", "time": 1, "sender": "…" },
    { "type": "reasoning", "label": "Мысли", "content": "…", "time": 2, "sender": "/models/…" },
    {
      "type": "action",
      "time": 3,
      "sender": "/models/…",
      "title": "Есть план",
      "content": "Я предлагаю такой план: сначала уточним тему…\n\n1. Уточнить тему и структуру\n2. Создать структуру слайдов\n3. Написать содержимое\n4. Сохранить файл",
      "action": "Начать",
      "color": "success"
    }
  ]
}
```

```json
{
  "type": "action",
  "time": 1784486745600,
  "sender": "/models/...",
  "title": "Есть план",
  "content": "Я предлагаю выполнить следующие шаги…\n\n1. …\n2. …",
  "action": "Начать",
  "color": "success"
}
```

**Правило UI:** если последний блок ленты — `action` и `!resolved` → кнопка с `action`/`color`. Confirm «Начать» → создаётся `task` с `plan` из content; «Принять» → закрытие без нового task.

---

### `task` — вложенная задача

Задача с планом и собственной лентой выполнения. Рекурсивная структура.

```json
{
  "type": "task",
  "time": 1784486745700,
  "sender": "user",
  "title": "Создать презентацию",
  "state": "active",
  "plan": [
    { "step": 1, "description": "Уточнить тему", "status": "done" },
    { "step": 2, "description": "Создать структуру", "status": "in_progress" },
    { "step": 3, "description": "Написать содержимое", "status": "proposed" }
  ],
  "ribbon": [
    { "type": "text", "time": 1784486745800, "sender": "/models/...", "content": "Начинаю..." },
    { "type": "tool_call", "time": 1784486745900, "sender": "/models/...", "method": "write_file", "args": {} }
  ]
}
```

| Поле | Тип | Описание |
|---|---|---|
| `title` | string | Название задачи |
| `state` | string | `'active'` \| `'completed'` |
| `plan` | array | Шаги плана (PDCA) |
| `ribbon` | array | Лента выполнения (рекурсивные блоки, включая вложенные `task`) |

Sticky-chrome в preview показывает plan **deepest active** task (самая глубокая `state:'active'`) и последний prompt из её ribbon (с подъёмом к родителю/корню). Breadcrumbs: `A › B` при вложенности.

**Жизненный цикл task** (начинается и заканчивается только после `action`):
1. ИИ: `reasoning` + `<plan>` → сервер пишет `action` (title/content MD/action/color), без поля `plan`
2. Пользователь жмёт «Начать» → `action.resolved`, создаётся `task` с `plan` (из content) и пустым `ribbon`
3. Выполнение — в `task.ribbon` (`text`, `tool_call`, `tool_result`, `reasoning`…)
4. Статусы `task.plan`: `'proposed'` → `'in_progress'` → `'done'`
5. Все `'done'` → `state:'completed'` + `action` «Принять» (последний в `task.ribbon`)
6. Пользователь принимает → задача закрыта

**Поля шага plan:**

| Поле | Тип | Описание |
|---|---|---|
| `step` | number | Номер шага |
| `description` | string | Описание |
| `status` | string | `'proposed'` \| `'in_progress'` \| `'done'` |

---

### `file` — ссылка на файл

Карточка файла (результат `write_file` или прикреплённый файл).

```json
{
  "type": "file",
  "time": 1784486746000,
  "sender": "/models/...",
  "path": "/folder/readme.md"
}
```

| Поле | Тип | Описание |
|---|---|---|
| `path` | string | Путь к файлу в WORK |

---

## Правила для LLM (messages)

При построении массива `messages` для LLM из `ribbon`:

- `prompt` → `{ role: 'user', content }`
- `text` → `{ role: 'assistant', content }`
- `reasoning` → **пропускается** (не отправляется обратно)
- `questions` → **пропускается** (ответы уже отправлены как `prompt`)
- `tool_call` → `{ role: 'assistant', function_call: { name, arguments } }` (при нативном function calling)
- `tool_result` → `{ role: 'function', name: tool, content }` (или `{ role: 'user', content }` в fallback)
- `action` → **пропускается** (UI-элемент)
- `task` → рекурсивный обход `task.ribbon`
- `file` → **пропускается** (UI-элемент)

---

## Из чего это состоит

- [`class.js`](/oda/$server/$folder/$file/$ai/class.js/~/handlers/pages/form/) — метаданные типа (`icon`, `label`)
- [`methods/prompt/`](/oda/$server/$folder/$file/$ai/methods/prompt/$method/class.js/~/handlers/pages/form/) — серверный метод tool-call цикла (стриминг, function calling, PDCA)
- [`methods/tts/`](/oda/$server/$folder/$file/$ai/methods/tts/$method/class.js/~/handlers/pages/form/) — синтез речи (Silero ONNX)
- [`triggers/on_save/`](/oda/$server/$folder/$file/$ai/triggers/on_save/$trigger/class.js/~/handlers/pages/form/) — автозапуск: заполнение system prompt + вызов prompt при первом сохранении
- [`handlers/preview/`](/oda/$server/$folder/$file/$ai/handlers/preview/$handler/class.js/~/handlers/pages/form/) — клиентский микрочат (лента + панель управления)

## В каком это состоянии

- ✅ Формат формализован (этот документ)
- ✅ Серверный `prompt` — унифицированный type-only ribbon, `action` вместо `pendingAction`
- ✅ Клиентский preview — рендер `prompt` / `reasoning` / `questions` / `tool_call` / `action` / `task`
- ✅ TTS — работает (Silero ONNX + browser + server)
- ✅ on_save — работает (автозаполнение system prompt)

## Дальнейшие планы

- Реализация `microchat-panel` (3 зоны: действия, ввод, настройки)
- Уровни доверия (trust level) в UI