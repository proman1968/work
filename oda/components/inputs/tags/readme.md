# `oda-tags-input`

## 1. Что это

Список значений чипами.

## 2. Зачем это нужно

Метки, ключевые слова, множественный выбор со своими значениями.

## 3. Как это работает

Enter или запятая добавляют, Backspace в пустом поле удаляет последний; двойной клик по чипу — правка, Enter — принять, Esc — отмена; подсказки из вариантов.

### Контракт для ИИ-агентов

- Тег: `oda-tags-input`; импорт: `/oda/components/inputs/tags/tags.js` (или `oda//tags`).
- Базовые свойства `oda-input`: `value`, `field`, `readonly`, `disabled`, `required`, `placeholder`, `borderless`, `dense`; методы `validate()`, `focus()`; геттеры `errors`, `isValid`. Изменение значения — событие `value-changed` (двусторонняя привязка `::value`).
- Свойства: `items`, `allowOther` (true).
- `value`: Array.
- Пример:

```html
<oda-tags-input ::value="tags"></oda-tags-input>
```

## 4. Из чего это состоит

- `tags.js` — `oda-tags-input`
- `index.html` — демо: обычное, только чтение, отключено, проверка

## 5. В каком это состоянии

✅ работает (проверено демо `index.html` в браузере).

## 6. Дальнейшие планы

- По мере использования в формах и таблицах.
