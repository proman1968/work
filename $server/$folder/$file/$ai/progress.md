# Прогресс: $ai / task.ai

## Последние изменения

- [15:40] `get_schema`: стандартный JSDoc (`@param`/`@returns`); без `@ai.*` / `TOOL_DESCRIPTIONS`.
- [15:15] Карточка file = history path из `save_file` (откат workPath). Fill-шаг → обязательный subplan по N; stub не advance.

## В работе

- Живой прогон: 5 слайдов → подшаги «Слайд 1…N» → history-карточки → Принять.
- Следующий шаг: `spawn_agent` / skills-as-tools.

## Ключевые решения

- **History в UI.** `save_file` уже возвращает снимок; harness не подменяет на `~/text/name`.
- **Fill = подплан.** N из answers → expand; иначе блок save. Stub не закрывает слайд.
- **JSDoc канон.** Обычный `@param`/`@returns` для IDE и `get_schema`; без второго словаря.

## Блокеры / Открытые вопросы

- (нет)
