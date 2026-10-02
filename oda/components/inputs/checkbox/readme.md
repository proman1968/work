# `oda-checkbox`

## 1. Что это

Флажок на нативном checkbox (`accent-color` темы) с подписью.

## 2. Зачем это нужно

Логические значения; флажки строк таблицы.

## 3. Как это работает

`value` и `state` синхронны; `threeStates` — цикл unchecked → checked → indeterminate; щелчок по подписи переключает.

### Контракт для ИИ-агентов

- Тег: `oda-checkbox`; импорт: `/oda/components/inputs/checkbox/checkbox.js` (или `oda//checkbox`).
- Базовые свойства `oda-input`: `value`, `field`, `readonly`, `disabled`, `required`, `placeholder`, `borderless`, `dense`; методы `validate()`, `focus()`; геттеры `errors`, `isValid`. Изменение значения — событие `value-changed` (двусторонняя привязка `::value`).
- Свойства: `caption`, `threeStates`, `state` (checked | unchecked | indeterminate).
- `value`: Boolean.
- Пример:

```html
<oda-checkbox caption="Согласен" ::value="agree"></oda-checkbox>
```

## 4. Из чего это состоит

- `checkbox.js` — `oda-checkbox`
- `index.html` — демо: обычное, только чтение, отключено, проверка

## 5. В каком это состоянии

✅ работает (проверено демо `index.html` в браузере).

## 6. Дальнейшие планы

- По мере использования в формах и таблицах.
