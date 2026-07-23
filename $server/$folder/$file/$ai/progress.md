# Прогресс: $ai / task.ai

## Последние изменения

- [15:15] Карточка file = history path из `save_file` (откат workPath). Fill-шаг → обязательный subplan по N; stub не advance. TOOL_DESCRIPTIONS без дублей @ai; harness не перетирает schema save_file.

## В работе

- Живой прогон: 5 слайдов → подшаги «Слайд 1…N» → history-карточки → Принять.
- Следующий шаг: `spawn_agent` / skills-as-tools.

## Ключевые решения

- **History в UI.** `save_file` уже возвращает снимок; harness не подменяет на `~/text/name`.
- **Fill = подплан.** N из answers → expand; иначе блок save. Stub не закрывает слайд.
- **@ai канон.** TOOL_DESCRIPTIONS только fallback; ensureHarnessFunctions не overwrite schema.

## Блокеры / Открытые вопросы

- (нет)
