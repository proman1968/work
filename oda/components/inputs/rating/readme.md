# `oda-rating-input`

## 1. Что это

Оценка звёздами.

## 2. Зачем это нужно

Приоритет, оценка, важность.

## 3. Как это работает

Щелчок по текущей звезде сбрасывает оценку; ← / → меняют её.

### Контракт для ИИ-агентов

- Тег: `oda-rating-input`; импорт: `/oda/components/inputs/rating/rating.js` (или `oda//rating`).
- Базовые свойства `oda-input`: `value`, `field`, `readonly`, `disabled`, `required`, `placeholder`, `borderless`, `dense`; методы `validate()`, `focus()`; геттеры `errors`, `isValid`. Изменение значения — событие `value-changed` (двусторонняя привязка `::value`).
- Свойства: `max` (5), `iconSize`.
- `value`: Number, 0 / `undefined` — нет.
- Пример:

```html
<oda-rating-input max="5"></oda-rating-input>
```

## 4. Из чего это состоит

- `rating.js` — `oda-rating-input`
- `index.html` — демо: обычное, только чтение, отключено, проверка

## 5. В каком это состоянии

✅ работает (проверено демо `index.html` в браузере).

## 6. Дальнейшие планы

- По мере использования в формах и таблицах.
