# `oda-list-input`

## 1. Что это

Список строк с правкой на месте.

## 2. Зачем это нужно

Перечни, шаги, пункты.

## 3. Как это работает

Enter — новая строка ниже; кнопки выше / ниже / удалить.

### Контракт для ИИ-агентов

- Тег: `oda-list-input`; импорт: `/oda/components/inputs/list/list.js` (или `oda//list`).
- Базовые свойства `oda-input`: `value`, `field`, `readonly`, `disabled`, `required`, `placeholder`, `borderless`, `dense`; методы `validate()`, `focus()`; геттеры `errors`, `isValid`. Изменение значения — событие `value-changed` (двусторонняя привязка `::value`).
- `value`: Array строк.
- Пример:

```html
<oda-list-input ::value="steps"></oda-list-input>
```

## 4. Из чего это состоит

- `list.js` — `oda-list-input` (наследник `oda-block-input`)
- `index.html` — демо: с данными, пустой, только чтение, свёрнутый

## 5. В каком это состоянии

✅ работает (проверено демо `index.html` в браузере).

## 6. Дальнейшие планы

- По мере использования в формах и таблицах.
