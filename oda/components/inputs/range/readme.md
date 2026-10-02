# `oda-range-input`

## 1. Что это

Число ползунком (нативный range) с выводом значения.

## 2. Зачем это нужно

Значения в известном диапазоне.

## 3. Как это работает

`min` / `max` / `step` — из свойств или поля (0 / 100 / 1).

### Контракт для ИИ-агентов

- Тег: `oda-range-input`; импорт: `/oda/components/inputs/range/range.js` (или `oda//range`).
- Базовые свойства `oda-input`: `value`, `field`, `readonly`, `disabled`, `required`, `placeholder`, `borderless`, `dense`; методы `validate()`, `focus()`; геттеры `errors`, `isValid`. Изменение значения — событие `value-changed` (двусторонняя привязка `::value`).
- Свойства: `min`, `max`, `step`.
- `value`: Number.
- Пример:

```html
<oda-range-input min="0" max="10"></oda-range-input>
```

## 4. Из чего это состоит

- `range.js` — `oda-range-input`
- `index.html` — демо: обычное, только чтение, отключено, проверка

## 5. В каком это состоянии

✅ работает (проверено демо `index.html` в браузере).

## 6. Дальнейшие планы

- По мере использования в формах и таблицах.
