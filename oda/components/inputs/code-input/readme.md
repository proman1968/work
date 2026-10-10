# `oda-code-input`

## 1. Что это

Поле исходного кода на `oda-code-editor` (Ace).

## 2. Зачем это нужно

Скрипты, выражения, JSON в формах.

## 3. Как это работает

Режим — `mode` или `field.mode` / `field.language`; выжимка — число строк.

### Контракт для ИИ-агентов

- Тег: `oda-code-input`; импорт: `/oda/components/inputs/code-input/code-input.js` (или `oda//code-input`).
- Базовые свойства `oda-input`: `value`, `field`, `readonly`, `disabled`, `required`, `placeholder`, `borderless`, `dense`; методы `validate()`, `focus()`; геттеры `errors`, `isValid`. Изменение значения — событие `value-changed` (двусторонняя привязка `::value`).
- Свойства: `mode`.
- `value`: String.
- Пример:

```html
<oda-code-input mode="json"></oda-code-input>
```

## 4. Из чего это состоит

- `code-input.js` — `oda-code-input` (наследник `oda-block-input`)
- `index.html` — демо: с данными, пустой, только чтение, свёрнутый

## 5. В каком это состоянии

✅ работает (проверено демо `index.html` в браузере).

## 6. Дальнейшие планы

- По мере использования в формах и таблицах.
