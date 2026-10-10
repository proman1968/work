# `oda-select-input`

## 1. Что это

Выбор из списка на нативном `select`: одиночный, `multiple`, своё значение.

## 2. Зачем это нужно

Выбор из фиксированного списка.

## 3. Как это работает

Пустой вариант — если поле не обязательно; `allowOther` — «Своё значение…» с текстовым полем.

### Контракт для ИИ-агентов

- Тег: `oda-select-input`; импорт: `/oda/components/inputs/select/select.js` (или `oda//select`).
- Базовые свойства `oda-input`: `value`, `field`, `readonly`, `disabled`, `required`, `placeholder`, `borderless`, `dense`; методы `validate()`, `focus()`; геттеры `errors`, `isValid`. Изменение значения — событие `value-changed` (двусторонняя привязка `::value`).
- Свойства: `items`, `multiple`, `allowOther`.
- `value`: значение варианта (Array при `multiple`).
- Пример:

```html
<oda-select-input :items="cities" ::value="city"></oda-select-input>
```

## 4. Из чего это состоит

- `select.js` — `oda-select-input`
- `index.html` — демо: обычное, только чтение, отключено, проверка

## 5. В каком это состоянии

✅ работает (проверено демо `index.html` в браузере).

## 6. Дальнейшие планы

- По мере использования в формах и таблицах.
