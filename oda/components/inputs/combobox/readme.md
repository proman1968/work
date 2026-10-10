# `oda-combobox-input`

## 1. Что это

Текстовый ввод с подсказками из вариантов (нативный `datalist`).

## 2. Зачем это нужно

Выбор из длинного списка или своё значение.

## 3. Как это работает

Текст совпал с подписью варианта — значение варианта; иначе текст (`allowOther`, по умолчанию да) или ошибка.

### Контракт для ИИ-агентов

- Тег: `oda-combobox-input`; импорт: `/oda/components/inputs/combobox/combobox.js` (или `oda//combobox`).
- Базовые свойства `oda-input`: `value`, `field`, `readonly`, `disabled`, `required`, `placeholder`, `borderless`, `dense`; методы `validate()`, `focus()`; геттеры `errors`, `isValid`. Изменение значения — событие `value-changed` (двусторонняя привязка `::value`).
- Свойства: `items`, `allowOther` (true).
- `value`: значение варианта или текст.
- Пример:

```html
<oda-combobox-input :items="countries"></oda-combobox-input>
```

## 4. Из чего это состоит

- `combobox.js` — `oda-combobox-input`
- `index.html` — демо: обычное, только чтение, отключено, проверка

## 5. В каком это состоянии

✅ работает (проверено демо `index.html` в браузере).

## 6. Дальнейшие планы

- По мере использования в формах и таблицах.
