# $ai — тип файла ИИ-задачи (task.ai)

## 1. Что это

Тип `$ai` — файловый носитель диалога и PDCA-цикла встроенного ИИ WORK (`task.ai`). Технически это JSON с `ribbon`, планом и контекстом; прикладно — панель управления задачей агента в зоне роли USER / BOSS / ADMIN.

**Видение:** агент уровня Cursor/Cline **на пайплайне WORK** (не IDE-host). Дорожная карта — §7.

## 2. Зачем это нужно

Даёт ИИ-управляющему единую точку: увидеть контекст пары user/class (readme, память, логи), спланировать работу, уточнить данные, вызвать tools в ACL роли и при ADMIN — нарастить класс через файлы с подтверждением. Вход в цикл — через `triggers/on_save`, не через host `file-handlers`.

## 3. Как это работает

1. Сохранение / обновление `task.ai` → [`triggers/on_save`](/$server/$folder/$file/$ai/triggers/on_save/$trigger/class.js/~/handlers/pages/form/) вызывает `taskFile.prompt(...)`.
2. `prompt` — **инстанс-метод файла** (наследуется из `class.js` типизатора через merge-цепочку, `this` = файл `task.ai`). **Однопроходный TYPE-driven пайплайн**:
   вход → `servicePrompt` текущего TYPE → контекст → **один ход LLM** → новый блок TYPE + tools →
   если тип ждёт пользователя (`text`/`action`/`form`/`questions`) — стоп;
   иначе следующий проход планируется через `this.async(() => prompt(...))` — без блокирующего цикла.
3. **Канон хода:** U (`prompt` + `servicePrompt`) → M (`thinking`, закрытый до канала) → S → **ровно один канал** (задан в `TYPES.*.servicePrompt`). Структурные каналы — **native FC-tools**: план `propose_plan({steps, intro})`, декомпозиция `subplan({steps})`, опрос `ask_user`, закрытие шага `complete_step`; XML-теги (`<plan>` строго JSON-массив, `<questions>`, `<subplan>`) — толерантный fallback для моделей без FC (невалидный JSON плана → шаги из нумерованного списка; каналы внутри `<reasoning>` не глотаются — thinking обрезается на первом теге). К servicePrompt драйвера добавляется ролевой оверлей `ROLE_OVERLAYS[role]` (USER — артефакт-first, BOSS — делегирование, ADMIN — inspect→diff→verify).
4. План = `TYPE.action` («План» / «Начать») → после confirm — `TYPE.task` + step-prompt в `task.ribbon`.
5. **Движок шагов:** модель закрывает шаг tool'ом `complete_step({step, summary})` → harness ставит `done` и пушит «Выполни шаг N+1»; после последнего шага — prompt «сформируй Отчёт» (с реальным списком артефактов из `collectArtifacts`) → action «Отчёт» → «Принять» закрывает задачу (`state: completed`) без хода модели. `<subplan>` создаёт вложенную подзадачу (стек задач в `body.ribbon`); закрытие всех подшагов закрывает шаг родителя и продвигает его.
   **Ворота (`stepEvidence`):** clarify-шаг (`stepNeedsClarify`) закрывается только после answered `questions`/`form`; do-шаг — только при успешном tool_result в span'е шага. Отказ — обучающая ошибка (ask_user / save_file). Step-prompt clarify-шага сам напоминает «начни с ask_user, не выдумывай значения».
6. Tools + ACL; опасные — `pendingAction` confirm. Лимит авто-проходов `MAX_AUTO_TURNS` → action «Продолжить».
7. Интернет: сервисные tools `search` / `fetch_url` (`services/SearXNG`, `/SERVICES/*` → FC автоматически).
8. UI — [`handlers/preview`](/$server/$folder/$file/$ai/handlers/preview/$handler/class.js/~/handlers/pages/form/).

Окно логов по умолчанию: 7 дней / до 60 сжатых строк (`body.logWindow` переопределяет).

## 4. Из чего это состоит

- `class.js` — **весь ИИ-харнесс**: схема `TYPES` + `servicePrompt`, метод `prompt` (один проход + `this.async`), парсер ответа, tools + ACL, контекст пары, usage
- `triggers/on_save/$trigger/` — вход в цикл (`taskFile.prompt(...)`)
- `handlers/preview/$handler/` — микрочат

Хелперы — внутри того же `class.js`, не соседним файлом (rules §1.11). Отдельного `methods/prompt` и `sources/modules/ai-prompt` больше нет.

## 5. В каком это состоянии

- ✅ PDCA harness, ask_user, idle propose inject
- ✅ `TYPES.servicePrompt` по каждому каналу (U→M→S→один канал)
- ✅ План = action «План» → «Начать» → `TYPE.task`; шаг Do = prompt в `task.ribbon`; `completed` после «Принять»
- ✅ `body.usage` — сумма токенов всех LLM-ходов (API + estimate fallback)
- ✅ Harness tools: `read_file` / `save_file` / `edit` / `ask_user` / `navigate` / `reset_context` / `complete_step` / `propose_plan` / `subplan`
- ✅ Каналы как FC-tools + толерантный fallback: reasoning не глотает теги, `<plan>` из нумерованного списка, textarea/text без фабрикации опций, впрыск состояния (evidence, артефакты, бюджет ходов) в Do-блок system
- ✅ Движок шагов: `complete_step` → done + следующий step-prompt; `<subplan>` → стек подзадач; «Принять» Отчёта → `completed`
- ✅ Ворота `stepEvidence`: clarify-шаг = answered опрос, do-шаг = успешный tool_result; Отчёт — только реальные артефакты (`collectArtifacts`); позиционный `save_file("имя")` → обучающая ошибка
- ✅ Ролевые оверлеи servicePrompt (`ROLE_OVERLAYS`: USER / BOSS / ADMIN)
- ✅ Интернет: `search` + `fetch_url` (сервис SearXNG)
- ✅ Толерантный парсер `<action>`: JSON-канон + атрибутная форма слабых моделей; сырые теги каналов не попадают в text
- ✅ Skills-as-tools: `list_skills` / `run_skill`
- ✅ `spawn_agent` (sequential nested task)
- ✅ `inspect_schema` (подготовка к trust/self-mod)
- ✅ `@/path` mentions в промпте → сниппеты в context
- ✅ Однопроходный `prompt` на файле + авто-ходы через `this.async` (лимит `MAX_AUTO_TURNS` → action «Продолжить»)
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
