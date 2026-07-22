# Прогресс: $ai / task.ai

## Последние изменения

- [11:00] Fix AskQuestion UI: options inline в `microchat-view-task` из сырого `item.ribbon` (oda-chat-form get/set не биндил); «Уточнить» без answers → hint. Данные questions уже были в task.ribbon.
- [10:55] MVP e2e до файла: обычный `write_file` без confirm; work `resultPath` + блок `type:file`; nested `$file` в preview; FC `tool_calls`+flush; презентация <4 → 4 шага; `MAX_IDLE_DO=3`; XML questions только select+options.
- [09:22] AskQuestion: снова inline `openAsk` в `microchat-view-task` (как 8b89715) — nested `~is` не рисует options; без `_taskItem`.
- [01:15] Plan propose: `extractBalancedJsonArray` + `ensureMinimumPlanSteps` — Light отдавал 1 шаг; action.content всегда из итоговых steps.
- [01:09] UI: откат костылей (`_taskItem` / native ask / openAsk) — ломали план; оставлены `item: null`, `collapsed: false`, nested `embedded` + get/set `questions` у form.
- [00:53] Do: `write_file` в FC; clarify→done; GigaChat `functionCalling` + AskQuestion select inject.
- [00:25] MVP harness: контекст пары user/class + ACL USER/BOSS/ADMIN + confirm ADMIN modify; вход через `triggers/on_save`.
- [00:25] Документация `$ai` по `rules.md`.

## В работе

- Живой UI-прогон: Начать → options видны → выбрать → Уточнить → write_file → file.
- Следующий шаг: `spawn_agent` / skills-as-tools.

## Ключевые решения

- **AskQuestion = native options в task, не oda-chat-form.** Причина: в live e2e questions уже в JSON, но form с get/set `_questionsList` не рисовал options; кнопка «Уточнить» тихо return без answers.
- **openAsk читает сырой `item.ribbon`.** Причина: `normalizeRibbon` каждый раз копирует блоки — лишний слой для Ask UI.
- **Обычный write_file без trust-confirm.** Причина: e2e «Уточнить → файл» ломался на лишнем «Подтвердить» при trustLevel=0; confirm только system-modify и прочие DANGEROUS.
- **resultPath = work file, не history.** Причина: save_file отдаёт log.path снимка — карточка открывала не тот объект.
- **На Plan-фазе не доверять одношаговому `<plan>`.** Причина: Light схлопывает propose; презентация <4 шагов → канон.
- **write_file в functions.** Причина: get_schema его не отдаёт.
- **FC + tool_calls flush.** Причина: иначе write_file дропается.
- **`MAX_IDLE_PROPOSE = 1`, `MAX_IDLE_DO = 3`.**
- **Не воскрешать file-handlers / skill-router.**

## Блокеры / Открытые вопросы

- (нет)
