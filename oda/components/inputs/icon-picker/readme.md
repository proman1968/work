# `oda-icon-picker-input`

## 1. Что это

Имя иконки (`lib:name`): предпросмотр, поле и выбор из дерева библиотек.

## 2. Зачем это нужно

Настройка иконок в формах и property-grid (заменил `tree-icon-selector`).

## 3. Как это работает

Ввод от 2 символов показывает подсказки по всем библиотекам; кнопка открывает `oda-icons-tree` в `ODA.showDropdown`, выбор — кликом.

### Контракт для ИИ-агентов

- Тег: `oda-icon-picker-input`; импорт: `/oda/components/inputs/icon-picker/icon-picker.js` (или `oda//icon-picker`).
- Базовые свойства `oda-input`: `value`, `field`, `readonly`, `disabled`, `required`, `placeholder`, `borderless`, `dense`; методы `validate()`, `focus()`; геттеры `errors`, `isValid`. Изменение значения — событие `value-changed` (двусторонняя привязка `::value`).
- `value`: String `lib:name`.
- Пример:

```html
<oda-icon-picker-input ::value="icon"></oda-icon-picker-input>
```

## 4. Из чего это состоит

- `icon-picker.js` — `oda-icon-picker-input`
- `index.html` — демо: обычное, только чтение, отключено, проверка

## 5. В каком это состоянии

✅ работает (проверено демо `index.html` в браузере).

## 6. Дальнейшие планы

- По мере использования в формах и таблицах.
