# `oda-table-input`

## 1. Что это

Поле-таблица: массив строк в `oda-table` с правкой ячеек.

## 2. Зачем это нужно

Табличные части документов (товары, позиции).

## 3. Как это работает

Колонки — `field.columns` `{id, label, type, options, calc, total}`; `calc` — выражение от полей строки (колонка только для чтения), `total` — итог в заголовке; кнопки: добавить, дублировать, удалить строку.

### Контракт для ИИ-агентов

- Тег: `oda-table-input`; импорт: `/oda/components/inputs/table-input/table-input.js` (или `oda//table-input`).
- Базовые свойства `oda-input`: `value`, `field`, `readonly`, `disabled`, `required`, `placeholder`, `borderless`, `dense`; методы `validate()`, `focus()`; геттеры `errors`, `isValid`. Изменение значения — событие `value-changed` (двусторонняя привязка `::value`).
- `value`: Array строк.
- Пример:

```html
<oda-table-input :field="{label: 'Товары', columns}"></oda-table-input>
```

## 4. Из чего это состоит

- `table-input.js` — `oda-table-input` (наследник `oda-block-input`)
- `index.html` — демо: с данными, пустой, только чтение, свёрнутый

## 5. В каком это состоянии

✅ работает (проверено демо `index.html` в браузере).

## 6. Дальнейшие планы

- По мере использования в формах и таблицах.
