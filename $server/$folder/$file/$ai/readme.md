# $ai — тип файла ИИ-задачи (task.ai)

## 1. Что это

Тип `$ai` — файловый носитель диалога и PDCA-цикла встроенного ИИ WORK (`task.ai`). Технически это JSON с `ribbon`, планом и контекстом; прикладно — панель управления задачей агента в зоне роли USER / BOSS / ADMIN.

**Видение:** агент уровня Cursor/Cline **на пайплайне WORK** (не IDE-host). Дорожная карта — §7.

## 2. Зачем это нужно

Даёт ИИ-управляющему единую точку: увидеть контекст пары user/class (readme, память, логи), спланировать работу, уточнить данные, вызвать tools в ACL роли и при ADMIN — нарастить класс через файлы с подтверждением. Вход в цикл — через `triggers/on_save`, не через host `file-handlers`.

## 3. Как это работает

1. Сохранение / обновление `task.ai` → [`triggers/on_save`](/$server/$folder/$file/$ai/triggers/on_save/$trigger/class.js/~/handlers/pages/form/) вызывает `taskFile.prompt(...)`.
2. **Два вида промптов, различаются ролью.** Реальный (role `USER|BOSS|ADMIN` — всегда приходит с клиента, default USER) пишется блоком `prompt` в ленту. Служебный (role `ASSISTENT` — самовызовы шагов плана и авто-ходов) подаётся **только на острие** messages текущего вызова модели: в ленту и в историю следующих ходов не попадает.
3. `prompt` — **инстанс-метод файла** (наследуется из `class.js` типизатора через merge-цепочку, `this` = файл `task.ai`). **Однопроходный автомат «одно действие за ход»**: состояние = тип последнего блока ленты; инъекция хода = `TYPES[состояние].servicePrompt` по роли. servicePrompt — команда «двигайся дальше», поэтому он есть только у состояний-продолжений (`prompt`, `thinking`, `tool_result`, `tool`, `task`, `file`, `error`); wait-состояния (`text`/`action`/`form`/`questions`) — стоп и ожидание пользователя, servicePrompt у них не бывает. Иначе следующий проход — `this.async(() => this.prompt({role:'ASSISTENT', …}))`.
4. **Канон хода:** после реального промпта единственное действие — **думать**: think-ход идёт **без functions** (tool невозможен на уровне API), и весь ответ целиком харнесс фиксирует блоком `thinking` — тип блока задаёт автомат, не разметка модели, теги не нужны. Следующий (action) ход — ровно одно действие: ответ обычным текстом ИЛИ один вызов функции по точному имени (`ask_user`, `propose_plan`, `subplan`, `save_file`, `complete_step`, `report`, `search`…). `servicePrompt` — строка или объект ролевых вариантов `{default, USER, BOSS, ADMIN, ASSISTENT}`. XML-теги — только толерантный fallback парсера для моделей без FC; инструкции их не требуют. Финальный отчёт — FC `report({content})` → text + action «Отчёт/Принять» строит харнесс (fallback: все пункты done + text-ответ → кнопку дорисовывает харнесс).
5. **Движок шагов:** «Начать» создаёт `TYPE.task`, и пункт уходит служебной инъекцией `this.prompt({role:'ASSISTENT', text:'Делай пункт N плана…'})` — step-prompt'ов в ленте больше нет. `complete_step({step, summary})` ставит `done` и шлёт следующий пункт той же инъекцией; после последнего — инъекция «сформируй Отчёт» (реальные артефакты из `collectArtifacts`) → action «Отчёт» → «Принять» закрывает задачу без хода модели. `subplan` — вложенная подзадача (стек в `body.ribbon`).
   **Ворота (`stepEvidence`):** span шага = блоки ленты после `step.startedAt`; clarify-шаг закрывается только answered `questions`/`form`, do-шаг — успешным tool_result. Отказ — обучающая ошибка.
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
- ✅ Автомат «одно действие за ход»: реальный промпт → думать → thinking → развилка; инъекции только на острие (в ленте и истории нет `[инструкция]`)
- ✅ Роль-дискриминатор: реальные промпты (USER/BOSS/ADMIN с клиента) vs служебные (ASSISTENT-самовызовы); ролевые варианты `TYPES.*.servicePrompt`
- ✅ План = action «План» → «Начать» → `TYPE.task`; пункты — ASSISTENT-инъекциями «Делай пункт N»; `completed` после «Принять»
- ✅ `body.usage` — сумма токенов всех LLM-ходов (API + estimate fallback)
- ✅ Harness tools: `read_file` / `save_file` / `edit` / `ask_user` / `navigate` / `reset_context` / `complete_step` / `propose_plan` / `subplan`
- ✅ Каналы как FC-tools + толерантный fallback: reasoning не глотает теги, `<plan>` из нумерованного списка, textarea/text без фабрикации опций, впрыск состояния (evidence, артефакты, бюджет ходов) в Do-блок system
- ✅ Движок шагов: `complete_step` → done + следующий пункт ASSISTENT-инъекцией; `<subplan>` → стек подзадач; «Принять» Отчёта → `completed`
- ✅ Ворота `stepEvidence` (по `step.startedAt`): clarify-шаг = answered опрос, do-шаг = успешный tool_result; Отчёт — только реальные артефакты (`collectArtifacts`); позиционный `save_file("имя")` → обучающая ошибка
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
