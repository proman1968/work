# `oda-segmented-input`

## 1. Что это

Сегментированный переключатель: ряд сегментов в общей рамке.

## 2. Зачем это нужно

Компактный выбор из 2–5 вариантов, фильтры, режимы.

## 3. Как это работает

`multiple` — несколько сегментов; иконки вариантов поддерживаются.

### Контракт для ИИ-агентов

- Тег: `oda-segmented-input`; импорт: `/oda/components/inputs/segmented/segmented.js` (или `oda//segmented`).
- Базовые свойства `oda-input`: `value`, `field`, `readonly`, `disabled`, `required`, `placeholder`, `borderless`, `dense`; методы `validate()`, `focus()`; геттеры `errors`, `isValid`. Изменение значения — событие `value-changed` (двусторонняя привязка `::value`).
- Свойства: `items`, `multiple`.
- `value`: значение (Array при `multiple`).
- Пример:

```html
<oda-segmented-input :items="modes"></oda-segmented-input>
```

## 4. Из чего это состоит

- `segmented.js` — `oda-segmented-input`
- `index.html` — демо: обычное, только чтение, отключено, проверка

## 5. В каком это состоянии

✅ работает (проверено демо `index.html` в браузере).

## 6. Дальнейшие планы

- По мере использования в формах и таблицах.
