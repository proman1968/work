# `oda-numeric-input`

## 1. Что это

Число на нативном `input` (`inputmode=decimal`): в фокусе — сырое число, без фокуса — формат `Intl.NumberFormat`.

## 2. Зачем это нужно

Ввод чисел и сумм с локальным форматом.

## 3. Как это работает

Ввод фильтруется: цифры, один разделитель, знак. Разделитель — точка или запятая; Enter вычисляет простое выражение (`= 2*3+1`); ↑/↓ — шаг `step`; значение ограничивается `min`/`max`.

### Контракт для ИИ-агентов

- Тег: `oda-numeric-input`; импорт: `/oda/components/inputs/numeric/numeric.js` (или `oda//numeric`).
- Базовые свойства `oda-input`: `value`, `field`, `readonly`, `disabled`, `required`, `placeholder`, `borderless`, `dense`; методы `validate()`, `focus()`; геттеры `errors`, `isValid`. Изменение значения — событие `value-changed` (двусторонняя привязка `::value`).
- Свойства: `min`, `max`, `step`, `accuracy` (знаков дробной части), `locale`, `currency`; из поля — `min`, `max`, `step`.
- `value`: Number, пусто — `undefined`.
- Пример:

```html
<oda-numeric-input currency="RUB" accuracy="2"></oda-numeric-input>
```

## 4. Из чего это состоит

- `numeric.js` — `oda-numeric-input`
- `index.html` — демо: обычное, только чтение, отключено, проверка

## 5. В каком это состоянии

✅ работает (проверено демо `index.html` в браузере).

## 6. Дальнейшие планы

- По мере использования в формах и таблицах.
