# $ai — тип файла ИИ-задачи (task.ai)

## 1. Что это

Тип `$ai` — файловый носитель диалога и PDCA-цикла встроенного ИИ WORK (`task.ai`). Технически это JSON с `ribbon`, планом и контекстом; прикладно — панель управления задачей агента в зоне роли USER / BOSS / ADMIN.

**Видение:** агент уровня Cursor/Cline **на пайплайне WORK** (не IDE-host). Дорожная карта — §7.

## 2. Зачем это нужно

Даёт ИИ-управляющему единую точку: увидеть контекст пары user/class (readme, память, логи), спланировать работу, уточнить данные, вызвать tools в ACL роли и при ADMIN — нарастить класс через файлы с подтверждением. Вход в цикл — через `triggers/on_save`, не через host `file-handlers`.

## 3. Как это работает

1. Сохранение / обновление `task.ai` → [`triggers/on_save`](/$server/$folder/$file/$ai/triggers/on_save/$trigger/class.js/~/handlers/pages/form/) поднимает harness.
2. [`methods/prompt`](/$server/$folder/$file/$ai/methods/prompt/$method/class.js/~/handlers/pages/form/) собирает system (идентичность WORK + канон; протокол хода — в `TYPES.servicePrompt`); через `buildHistoryFromRibbon` упаковывает ленту в `messages`; стримит с functions. Usage (`body.usage`) — сумма всех LLM-ходов (API `include_usage` или estimate по messages, включая system/servicePrompt).
3. **Канон хода:** U (`prompt` + `servicePrompt`) → M (`thinking`) → S → **ровно один канал**.
4. Предложение плана = `TYPE.action` (`title: План`, tip «Начать», content = шаги). `TYPE.task` создаётся **только после** confirm. Каждый шаг Do = `prompt` в `task.ribbon` («Выполни шаг N…») + тот же канон U→M→S. `completed` — только после «Принять».
5. Tools с `params.role`. ADMIN system-modify через `pendingAction` confirm.
6. UI — [`handlers/preview`](/$server/$folder/$file/$ai/handlers/preview/$handler/class.js/~/handlers/pages/form/).
7. Артефакты Do: один `filename`; history пишет платформа. Точечные правки — `edit_file`.
8. Лимит итераций (default **30**): «Продолжить» + `pendingContinue`.

Окно логов по умолчанию: 7 дней / до 60 сжатых строк (`body.logWindow` переопределяет).

## 4. Из чего это состоит

- `class.js` — схема `TYPES` + `servicePrompt`
- `methods/prompt/$method/` — harness PDCA (`pendingPlan` → action «План» → task; Do = step-prompt в `task.ribbon`; протокол — `TYPES.servicePrompt`)
- `triggers/on_save/$trigger/` — вход в цикл
- `handlers/preview/$handler/` — микрочат

Вспомогательные модули **не** класть рядом с `$method/class.js` (см. rules §1.11).

## 5. В каком это состоянии

- ✅ PDCA harness, ask_user, idle propose inject
- ✅ `TYPES.servicePrompt` по каждому каналу (U→M→S→один канал)
- ✅ План = action «План» → «Начать» → `TYPE.task`; шаг Do = prompt в `task.ribbon`; `completed` после «Принять»
- ✅ `body.usage` — сумма токенов всех LLM-ходов (API + estimate fallback)
- ✅ Harness tools: `read_file` / `save_file` / `edit_file` / `ask_user` / `navigate` / `reset_context`
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
| 2 | edit_file в harness + карточка file | ✅ |
| 3 | skills-as-tools + @path | ✅ |
| 4 | sequential spawn_agent | ✅ |
| 5 | trust + self-mod WORK (whitepaper §10) | 🔧 foundation (`inspect_schema`) |
