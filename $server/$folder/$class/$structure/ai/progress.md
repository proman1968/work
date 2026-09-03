# Прогресс: $structure/ai

## Последние изменения
- [17:20] One-shot `prompt.js`: без session harness; `answerOnce` / `runAgent`; ответ `items[]` для вставки в `.task`. `system.md` + `buildSystemPrompt` из ~/ai. `$method` → `runPrompt`. on_save — общий buildSystemPrompt.
- [15:59] Слот `ai/` на `$structure`: harness, task.js, agents/, `prompt/$method`; `_methods` ∪ `~/ai/*`. One-shot `/BASE?prompt&agent=…`; `.task` делегирует. Причина: вызов агентов между классами без файла-владельца поведения.
