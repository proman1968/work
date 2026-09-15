# Прогресс: $class/ai

## Последние изменения
- [17:12] Ошибка create не уводит с create. Write не валит бокс и не оставляет `mode: do`. Activation в меню только после ok read.
- [17:00] После APPROVE activation — только create. Search убран из do. Write в отсутствующий класс не валит бокс (`need=create`).
- [16:25] Агенты — только ход. `$ai` / MODELS / odant убраны из work/explore/image. Закон места — в readme `/MODELS`.

## В работе
- Нет.

## Ключевые решения
- Решение: ошибка create не жжёт ход; activation без ok read не в меню; write/throw не оставляет do. Причина: лента `/PROVIDER/ODANT` → write фразой → второй work сразу в do.
- Решение: после принятой activation меню do = create. Причина: pick search/write вместо create в несуществующий путь.
- Решение: пакет агентов не знает прикладной каталог. Причина: `if (type === '$ai')` в work — не принцип create.

## Блокеры / Открытые вопросы
- Нет.
