# Прогресс: $ai / task.ai

## Последние изменения

- [21:05] `prompt.execute` — тонкий TYPE-driven пайплайн (`servicePrompt` → LLM → TYPE → auto/stop); хелперы в `sources/modules/ai-prompt/legacy.js` (§1.11).
- [12:38] Убран `sources/modules/task-control` / `body.control`; протокол хода — `TYPES.servicePrompt`; harness — в `methods/prompt`.

## В работе

- Фаза 5: trust markings UI + plan→diff→apply для `$class`/handlers.
- Параллельные subagents + merge.

## Ключевые решения

- **system = identity; ход = servicePrompt.** Протокол после блоков ленты.
- **body.usage = истина по задаче.** Все LLM-ходы, включая system/servicePrompt.
- **Фаза = данные файла.** `pendingPlan`, `task` в ribbon, статусы шагов — без параллельного `body.control`.
- **Plan-first / Cursor-analog.** Фазы 1–4; TTS = Piper; JSDoc канон.

## Блокеры / Открытые вопросы

- (нет)
