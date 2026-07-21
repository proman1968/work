# $ai — тип файла ИИ-задачи (task.ai)

## 1. Что это

Тип `$ai` — файловый носитель диалога и PDCA-цикла встроенного ИИ WORK (`task.ai`). Технически это JSON с `ribbon`, планом и контекстом; прикладно — панель управления задачей агента в зоне роли USER / BOSS / ADMIN.

## 2. Зачем это нужно

Даёт ИИ-управляющему единую точку: увидеть контекст пары user/class (readme, память, логи), спланировать работу, уточнить данные, вызвать tools в ACL роли и при ADMIN — нарастить класс через файлы с подтверждением. Вход в цикл — через `triggers/on_save`, не через host `file-handlers`.

## 3. Как это работает

1. Сохранение / обновление `task.ai` → [`triggers/on_save`](/$server/$folder/$file/$ai/triggers/on_save/$trigger/class.js/~/handlers/pages/form/) поднимает harness.
2. [`methods/prompt`](/$server/$folder/$file/$ai/methods/prompt/$method/class.js/~/handlers/pages/form/) собирает system: роль, бандлы class+user, PDCA; стримит модель с functions из `get_schema` + services + `ask_user`.
3. Tools выполняются с `params.role`. USER/BOSS не меняют типизаторы/`class.js`. ADMIN system-modify всегда через `pendingAction` confirm.
4. UI — [`handlers/preview`](/$server/$folder/$file/$ai/handlers/preview/$handler/class.js/~/handlers/pages/form/): ribbon, questions/form/action, nested task.

Окно логов по умолчанию: 7 дней / до 60 сжатых строк (`body.logWindow` переопределяет).

## 4. Из чего это состоит

- `class.js` — схема `TYPES` блоков ribbon (контракт данных диалога для UI и harness)
- `methods/prompt/$method/` — серверный harness PDCA, tools, ACL, контекст пары (исполнение задачи ИИ)
- `triggers/on_save/$trigger/` — реакция на сохранение файла (вход в цикл агента)
- `handlers/preview/$handler/` — микрочат: лента, панель, формы (управление задачей человеком)

## 5. В каком это состоянии

- ✅ PDCA harness, ask_user, idle propose inject (Cursor AskQuestion: select+options)
- ✅ Harness FC tools: `write_file` / `read_file` / `ask_user` / `navigate` (не только get_schema)
- ✅ GigaChat Light/Pro: `functionCalling: true` (tools уходят в API)
- ✅ Контекст пары class+user (readme, .mem, логи)
- ✅ ACL ролей USER/BOSS/ADMIN + confirm для ADMIN modify
- ✅ Preview: action / form / questions (AskQuestion native options в task)
- 🔧 spawn_agent / skills как tools harness
- ❌ host file-handlers / skill-router (запрещены как костыль)

## 6. Дальнейшие планы

- Sequential `spawn_agent` внутри task.ai
- Skills через tools/`get_schema`, без host-router
- Вычистить мёртвые docs/тесты про file-handlers
- RAG top-k по окну логов (после стабилизации MVP)
