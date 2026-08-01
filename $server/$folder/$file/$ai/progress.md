# Прогресс: $ai / task.ai

## Последние изменения

- [01:22] **task = expander + steps.** `microchat-view-task` как обычный `microchat-view`: summary = `label` (из `body.title`); внутри чеклист `steps` (свой collapse, старт закрыт) и ribbon `items`. `pipe.build` пишет `{description, status}` и пустой `items` — без дублей шагов в ленту.

## В работе

- Обкатка полного цикла на живых прогонах по `PIPE`: thinking → plan → Принять → task → step → action/research → complete_step → … → report → Принять; Stop mid-flight; смена модели.
- Доработка `PIPE`: subplan-декомпозиция в ходе, teach-ворота прозы, spawn_agent, usage-учёт; текстовый fallback FC для моделей без functionCalling.

## Ключевые решения

- **PIPE — конечный автомат**, не плоский список маршрутов: дерево узлов-состояний + один движок `_walk`. Меньше методов, декларативность.
- **Дерево PIPE — `pipe.js` (`export default`)**, рядом с `class.js`: данные автомата отделены от харнесса, грузятся через `importScript`.
- **task UI — два уровня open:** оболочка (`autoOpen`/`userOpen`) и чеклист steps (`collapsed`, независимо); `items` — только ход выполнения, не копия чеклиста.
- **`build` узла** собирает блок ленты из ответа модели; внутри arrow нельзя опираться на `this` создаваемого объекта — считать локально.
- **stop / change_model — методы файла**, рядом с `prompt` (общий abort Map с автоматом), не `$method`-папки и не контрабанда через prompt.

## Блокеры / Открытые вопросы

- Модели без functionCalling: FC-ходы падают в текст (wait) — нужен текстовый fallback вызовов.
