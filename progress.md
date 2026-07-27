# Прогресс: WORK — платформа управления деятельностью

## Последние изменения

- [17:30] Надёжный протокол каналов ИИ: план/декомпозиция — native FC-tools `propose_plan`/`subplan` (XML — толерантный fallback: reasoning не глотает каналы, `<plan>` из нумерованного списка); textarea/text без фабрикации опций; впрыск состояния шага (evidence, артефакты, бюджет ходов) в system. Детали — `$server/$folder/$file/$ai/progress.md`. 206 pass.
- [11:55] ИИ-харнесс консолидирован в `$server/$folder/$file/$ai/class.js`: `prompt` — инстанс-метод файла, однопроходный, авто-ходы через `this.async`; удалены `methods/prompt/$method` и `sources/modules/ai-prompt`; `npm test` починен (`node --test tests/*.test.js`, 161 pass).
- [18:25] GigaChat 422: при force — только `save_file` в functions; sanitize messages (сироты FC→prose); harness-схема вместо schema.

## В работе

- Покрытие директорий `readme.md` по стандарту `rules/`.

## Ключевые решения

- **GigaChat force** — `body.functions = [save_file]` only; иначе 422 `undefined functions in dialog history`.
- **create ≠ файл** — артефакт только через `save_file`.

## Блокеры / Открытые вопросы

- Добавлять ли `.progress.md/history/` в `.gitignore`?
