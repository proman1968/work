# `oda-color-input`

## 1. Что это

Цвет: образец (нативный `input type=color`) и поле hex.

## 2. Зачем это нужно

Выбор цвета (ранее отсутствовал, на него ссылались `$editor: color-picker`).

## 3. Как это работает

Поле — без решётки (она выведена отдельно). Принимаются `#rrggbb`, `rgb()`, короткие hex и имена цветов; ошибка подсвечивается, образец показывает серый.

### Контракт для ИИ-агентов

- Тег: `oda-color-input`; импорт: `/oda/components/inputs/color/color.js` (или `oda//color`).
- Базовые свойства `oda-input`: `value`, `field`, `readonly`, `disabled`, `required`, `placeholder`, `borderless`, `dense`; методы `validate()`, `focus()`; геттеры `errors`, `isValid`. Изменение значения — событие `value-changed` (двусторонняя привязка `::value`).
- `value`: строка цвета (`#rrggbb` и др.), пусто — `''`.
- Пример:

```html
<oda-color-input value="#4b0082"></oda-color-input>
```

## 4. Из чего это состоит

- `color.js` — `oda-color-input`
- `index.html` — демо: обычное, только чтение, отключено, проверка

## 5. В каком это состоянии

✅ работает (проверено демо `index.html` в браузере).

## 6. Дальнейшие планы

- По мере использования в формах и таблицах.
