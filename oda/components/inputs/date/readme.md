# `oda-date-input`

## 1. Что это

Дата и время на нативном `input`: date, time, datetime-local, month, week.

## 2. Зачем это нужно

Один контрол для всех типов дат (заменил `oda-datetime-input`).

## 3. Как это работает

Тип — `inputType`, иначе по `field.type` (`date`, `time`, `datetime` / `DateTime` / `timestamp`, `month`, `week`).

### Контракт для ИИ-агентов

- Тег: `oda-date-input`; импорт: `/oda/components/inputs/date/date.js` (или `oda//date`).
- Базовые свойства `oda-input`: `value`, `field`, `readonly`, `disabled`, `required`, `placeholder`, `borderless`, `dense`; методы `validate()`, `focus()`; геттеры `errors`, `isValid`. Изменение значения — событие `value-changed` (двусторонняя привязка `::value`).
- Свойства: `inputType`, `min`, `max`; из поля — `min`, `max`, `step`.
- `value`: строка в нативном формате, пусто — `''`.
- Пример:

```html
<oda-date-input input-type="datetime-local"></oda-date-input>
```

## 4. Из чего это состоит

- `date.js` — `oda-date-input`
- `index.html` — демо: обычное, только чтение, отключено, проверка

## 5. В каком это состоянии

✅ работает (проверено демо `index.html` в браузере).

## 6. Дальнейшие планы

- По мере использования в формах и таблицах.
