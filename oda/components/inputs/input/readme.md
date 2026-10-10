# `oda-input, oda-options-input`

## 1. Что это

Базовые контролы ввода: `oda-input` — строчное поле с рамкой, состояниями и проверкой; `oda-options-input` — поле выбора из вариантов.

## 2. Зачем это нужно

Единый контракт всех контролов: одно свойство значения, одно описание поля, одинаковые состояния и оформление. Форма и таблица работают с любым контролом одинаково.

## 3. Как это работает

- Хост — рамка поля (`@apply --control`): hover, фокус (`:focus-within`), `invalid` (после `validate()` или ухода фокуса), `disabled`, `locked` (только чтение), `borderless`, `dense`.
- Наследник дописывает нативный элемент с `class="control"` — он получает общие стили и `focus()`.
- Явные свойства (`readonly`, `required`, `placeholder`) приоритетнее полей описания `field`.
- `oda-options-input.options` приводит `items` / `field.items` / `field.options` к `[{value, label, icon, description, disabled}]`.

### Контракт для ИИ-агентов

- Тег: `oda-input, oda-options-input`; импорт: `/oda/components/inputs/input/input.js` (или `oda//input`).
- 
- Свойства: `value`, `field` (объект или JSON в атрибуте), `readonly`, `disabled`, `required`, `placeholder`, `borderless`, `dense`, `iconSize`; у выбора — `items`, `allowOther`.
- Проверка: переопределить `get validationErrors()` (массив сообщений); пустое обязательное — «Обязательное поле».
- Признак блочного контрола — атрибут `is-block`.
- Пример:

```html
<oda-text-input required placeholder="Имя"></oda-text-input>
```

## 4. Из чего это состоит

- `input.js` — `oda-input`, `oda-options-input` (база строчных контролов и контролов выбора)
- `index.html` — демо состояний

## 5. В каком это состоянии

✅ работает (проверено демо `index.html` в браузере).

## 6. Дальнейшие планы

- По мере использования в формах и таблицах.
