# Прогресс: $ai / task.ai

## Последние изменения

- [09:55] Служебные методы файла `stop` и `change_model`. 1) `stop` — `requestAbort` + `chat.done stopped`; task/pendingAction не трогает. 2) `change_model` — пишет `body.model` через fsp (без on_save). 3) Abort подключён к новому автомату: `clearAbort` на реальном ходе, проверка в `streamTurn` / `twoBeatMove` / `expectMove` / `fcMove` / `scheduleSelfCall`. 4) Preview: `fetch('stop')`, `fetch('change_model')` вместо `prompt {stop}` и полного `save`. Убран `wantStop` из `parseInput`.

## В работе

- Обкатка полного цикла на живых прогонах: plan → Принять → task → шаги → report → Принять; Stop mid-flight; смена модели.
- Перенос в новый `prompt`: subplan, teach-ворота, spawn_agent, usage; текстовый fallback FC для GigaChat Light.

## Ключевые решения

- **stop / change_model — методы файла**, рядом с `prompt` (общий abort Map с автоматом), не `$method`-папки и не контрабанда через prompt.
- **Stop не отменяет задачу** — только текущую генерацию/самовызовы.
- **change_model не абортит** — новая модель со следующего `resolveChatModel`.

## Блокеры / Открытые вопросы

- Модели без functionCalling: FC-ходы падают в текст (wait) — нужен текстовый fallback вызовов.
