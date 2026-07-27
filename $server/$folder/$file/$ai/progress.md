# Прогресс: $ai / task.ai

## Последние изменения

- [18:55] Think-фаза без тегов + каналы только через function calling (разбор прогона `1785165925951` — GigaChat Light подумал без `<reasoning>`, парсер записал text, wait-состояние убило автомат). Принцип: тип блока задаёт харнесс по фазе, а не разметка модели. 1) Think-ход (`thinkPhase` = реальный prompt-драйвер или ASSISTENT-текст шага): functions в запрос **не передаются** (tool физически невозможен), весь ответ целиком → блок `thinking` (`stripReasoningWrapper` снимает случайные обёртки); парсер каналов на этом ходе не вызывается — классификации нет по построению. 2) Action-ход: инструкции — технические команды с точными именами функций («вызови функцию ask_user({questions})», propose_plan, save_file, complete_step, search); либо ответ обычным текстом, либо один FC-вызов; XML-теги из servicePrompt удалены (остались только как толерантный fallback парсера). 3) Новый FC-канал `report({content})` — финальный отчёт: text-блок + action «Отчёт/Принять» строит харнесс; детерминированный fallback — если все пункты done и ответ text, кнопку «Принять» дорисовывает харнесс сам (модель не просят рисовать `<action>`).
- [18:25] servicePrompt = команда «двигайся дальше»: у wait-состояний (`text`, `action`, `form`, `questions` — `WAIT_USER_TYPES`) servicePrompt удалён — автомат в них остановлен, следующего хода модели нет, команда движения там противоречие. servicePrompt остаётся только у состояний-продолжений: `prompt` (думай), `thinking` (одно действие), `tool_result`, `tool`, `task`, `file`, `error`. `resolveServicePrompt` без текста даёт `''` — инъекции нет; остановку обеспечивает `WAIT_USER_TYPES`, не тексты.
- [17:45] Канон промптов: реальные vs инъекции, различение по роли. 1) Два вида промптов: реальный (role `USER|BOSS|ADMIN`, всегда приходит с клиента, default USER) → блок `prompt` в ленту; служебный (role `ASSISTENT` — самовызовы шагов) → **только на острие** messages текущего вызова, в ленту и историю следующих ходов не попадает. 2) Автомат «одно действие за ход»: после реального промпта инъекция `TYPES.prompt.servicePrompt` = «только думай»; блок `thinking` фиксируется в ленту; следующий ход — развилка `TYPES.thinking.servicePrompt` (ответ text | ask_user | propose_plan | исполнение пункта). 3) `servicePrompt` — строка или объект ролевых вариантов `{default, USER, BOSS, ADMIN, ASSISTENT}`; `driverDirective` и `ROLE_OVERLAYS` схлопнуты в TYPES (один источник правды). 4) Шаги плана: step-prompt'ы `sender:'WORK'` из лент удалены; после «Начать»/`complete_step`/subplan — `this.async(() => this.prompt({role:'ASSISTENT', text:'Делай пункт N плана…'}))`; финальный Отчёт — той же инъекцией. `stepEvidence` — по `step.startedAt` (span = блоки ленты после старта шага), не по step-prompt. 5) `buildHistoryFromRibbon` — только факты диалога: вырезаны `inServiceScope`/`appendServicePrompt`/вклейка `[инструкция]` в прошлые сообщения (раньше модель получала пачку устаревших протоколов в «истории»). 6) `promptTurn`-обёртка влита в `prompt` (this = task.ai); named-export для тестов удалён (в DATA попадает только default); удалён мёртвый `methods/prompt/$method` (импортировал несуществующий `ai-prompt/legacy.js`); тесты-фиксаторы старых внутренностей (prompt-pipeline, plan-steps, interactive-types, role-acl, fc-args, context-bundle, mvp-e2e-roles, create-class-only) удалены — контракт проверяет `import-script.test.js` (merge-цепочка, default export). 7) Клиент всегда шлёт `role`: preview (`_userRole()`, default USER) и on_save-триггер. Прогон: tests/*.test.js — 90 pass; `tests/class/distributed-folder` падал до правок (не связан).

## В работе

- Обкатка thinking-first автомата на живых прогонах (следить: модели, игнорирующие «только думай»).
- Фаза 5: trust markings UI + plan→diff→apply для `$class`/handlers.
- Параллельные subagents + merge.

## Ключевые решения

- **Роль — дискриминатор промпта.** Реальный (USER/BOSS/ADMIN, с клиента) → лента; ASSISTENT (система) → только острие.
- **Инъекции ephemeral.** `TYPES[состояние].servicePrompt` по паре (тип последнего блока, роль); в JSON задачи не хранятся, в историю не накапливаются.
- **prompt = метод файла.** Один проход; продолжение — `this.async(() => this.prompt({role:'ASSISTENT', …}))`.
- **system = identity; ход = одна инъекция.** Думай → один канал.
- **body.usage = истина по задаче.** Все LLM-ходы.
- **Фаза = данные файла.** `task` в ribbon, статусы шагов + `startedAt`.

## Блокеры / Открытые вопросы

- (нет)
