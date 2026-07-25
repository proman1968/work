# $ai — тип файла ИИ-задачи (task.ai)

## 1. Что это

Тип `$ai` — файловый носитель диалога и PDCA-цикла встроенного ИИ WORK (`task.ai`). Технически это JSON с `ribbon`, планом и контекстом; прикладно — панель управления задачей агента в зоне роли USER / BOSS / ADMIN.

**Видение:** агент уровня Cursor/Cline **на пайплайне WORK** (не IDE-host). Дорожная карта — §7.

## 2. Зачем это нужно

Даёт ИИ-управляющему единую точку: увидеть контекст пары user/class (readme, память, логи), спланировать работу, уточнить данные, вызвать tools в ACL роли и при ADMIN — нарастить класс через файлы с подтверждением. Вход в цикл — через `triggers/on_save`, не через host `file-handlers`.

## 3. Как это работает

1. Сохранение / обновление `task.ai` → [`triggers/on_save`](/$server/$folder/$file/$ai/triggers/on_save/$trigger/class.js/~/handlers/pages/form/) поднимает harness.
2. [`methods/prompt`](/$server/$folder/$file/$ai/methods/prompt/$method/class.js/~/handlers/pages/form/) — **TYPE-driven пайплайн**:
   вход → `servicePrompt` текущего TYPE → контекст → LLM → новый блок TYPE →
   если тип ждёт пользователя (`text`/`action`/`form`/`questions`) — стоп;
   иначе авто-ход с `servicePrompt` нового блока.
3. **Канон хода:** U (`prompt` + `servicePrompt`) → M (`thinking`) → S → **ровно один канал** (задан в `TYPES.*.servicePrompt`).
4. План = `TYPE.action` («План» / «Начать») → после confirm — `TYPE.task` + step-prompt в `task.ribbon`.
5. Tools + ACL; опасные — `pendingAction` confirm.
6. UI — [`handlers/preview`](/$server/$folder/$file/$ai/handlers/preview/$handler/class.js/~/handlers/pages/form/).
7. Хелперы парсера/tools — [`sources/modules/ai-prompt`](/sources/modules/ai-prompt/readme.md/~/handlers/pages/form/) (не рядом с `$method`).

Окно логов по умолчанию: 7 дней / до 60 сжатых строк (`body.logWindow` переопределяет).

## 4. Из чего это состоит

- `class.js` — схема `TYPES` + `servicePrompt`
- `methods/prompt/$method/class.js` — тонкий TYPE-driven `execute` (протокол — `TYPES.servicePrompt`)
- `triggers/on_save/$trigger/` — вход в цикл
- `handlers/preview/$handler/` — микрочат

Вспомогательные модули **не** класть рядом с `$method/class.js` (см. rules §1.11).

## 5. В каком это состоянии

- ✅ PDCA harness, ask_user, idle propose inject
- ✅ `TYPES.servicePrompt` по каждому каналу (U→M→S→один канал)
- ✅ План = action «План» → «Начать» → `TYPE.task`; шаг Do = prompt в `task.ribbon`; `completed` после «Принять»
- ✅ `body.usage` — сумма токенов всех LLM-ходов (API + estimate fallback)
- ✅ Harness tools: `read_file` / `save_file` / `edit` / `ask_user` / `navigate` / `reset_context`
- ✅ Skills-as-tools: `list_skills` / `run_skill`
- ✅ `spawn_agent` (sequential nested task)
- ✅ `inspect_schema` (подготовка к trust/self-mod)
- ✅ `@/path` mentions в промпте → сниппеты в context
- ✅ Continue после лимита итераций (`pendingContinue`)
- ✅ GigaChat / z.ai function calling
- ✅ Контекст пары class+user; ACL + pendingAction
- ✅ Preview microchat + TTS Piper
- ❌ host file-handlers / skill-router (запрещены)
- 🔧 Параллельные subagents; trust markings UI; hot-reload self-mod (фаза 5)

## 6. Дальнейшие планы

- Параллельный spawn + merge в родителя
- Trust markings на файлах + plan→diff→confirm→apply для `$class`/handlers
- RAG top-k по окну логов

## 7. Дорожная карта Cursor-аналога

| Фаза | Содержание | Статус |
|------|------------|--------|
| 0 | MVP PDCA + microchat + save_file | ✅ |
| 1 | maxIterations 30 + Continue + orphan tool | ✅ |
| 2 | edit в harness + карточка file | ✅ |
| 3 | skills-as-tools + @path | ✅ |
| 4 | sequential spawn_agent | ✅ |
| 5 | trust + self-mod WORK (whitepaper §10) | 🔧 foundation (`inspect_schema`) |
