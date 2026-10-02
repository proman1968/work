# `oda-radio-input`

## 1. Что это

Выбор одного варианта группой нативных radio с пояснениями.

## 2. Зачем это нужно

Когда варианты нужно видеть все сразу (заменил `oda-radio-button`).

## 3. Как это работает

`inline` — в ряд; `allowOther` — своё значение; выбранный вариант подсвечен акцентом.

### Контракт для ИИ-агентов

- Тег: `oda-radio-input`; импорт: `/oda/components/inputs/radio/radio.js` (или `oda//radio`).
- Базовые свойства `oda-input`: `value`, `field`, `readonly`, `disabled`, `required`, `placeholder`, `borderless`, `dense`; методы `validate()`, `focus()`; геттеры `errors`, `isValid`. Изменение значения — событие `value-changed` (двусторонняя привязка `::value`).
- Свойства: `items`, `inline`, `allowOther`.
- `value`: значение варианта.
- Пример:

```html
<oda-radio-input inline :items="sizes"></oda-radio-input>
```

## 4. Из чего это состоит

- `radio.js` — `oda-radio-input`
- `index.html` — демо: обычное, только чтение, отключено, проверка

## 5. В каком это состоянии

✅ работает (проверено демо `index.html` в браузере).

## 6. Дальнейшие планы

- По мере использования в формах и таблицах.
