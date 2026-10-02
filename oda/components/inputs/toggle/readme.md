# `oda-toggle`

## 1. Что это

Переключатель (role=switch) на нативном checkbox.

## 2. Зачем это нужно

Включение режимов (вместо флажка там, где действие мгновенное).

## 3. Как это работает

Трек и бегунок — токены темы; подпись текущего состояния справа.

### Контракт для ИИ-агентов

- Тег: `oda-toggle`; импорт: `/oda/components/inputs/toggle/toggle.js` (или `oda//toggle`).
- Базовые свойства `oda-input`: `value`, `field`, `readonly`, `disabled`, `required`, `placeholder`, `borderless`, `dense`; методы `validate()`, `focus()`; геттеры `errors`, `isValid`. Изменение значения — событие `value-changed` (двусторонняя привязка `::value`).
- Свойства: `checkedLabel`, `uncheckedLabel`, `size` (высота трека, px).
- `value`: Boolean (раньше `toggled`).
- Пример:

```html
<oda-toggle ::value="enabled" checked-label="Вкл"></oda-toggle>
```

## 4. Из чего это состоит

- `toggle.js` — `oda-toggle`
- `index.html` — демо: обычное, только чтение, отключено, проверка

## 5. В каком это состоянии

✅ работает (проверено демо `index.html` в браузере).

## 6. Дальнейшие планы

- По мере использования в формах и таблицах.
