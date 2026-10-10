# `oda-textarea-input`

## 1. Что это

Многострочный текст: блочный контрол на нативной textarea.

## 2. Зачем это нужно

Описания, заметки, комментарии.

## 3. Как это работает

Высота по содержимому (`field-sizing: content`): от 3 строк до ~20em; выжимка — первая непустая строка.

### Контракт для ИИ-агентов

- Тег: `oda-textarea-input`; импорт: `/oda/components/inputs/textarea/textarea.js` (или `oda//textarea`).
- Базовые свойства `oda-input`: `value`, `field`, `readonly`, `disabled`, `required`, `placeholder`, `borderless`, `dense`; методы `validate()`, `focus()`; геттеры `errors`, `isValid`. Изменение значения — событие `value-changed` (двусторонняя привязка `::value`).
- `value`: String.
- Пример:

```html
<oda-textarea-input field='{"label":"Описание"}'></oda-textarea-input>
```

## 4. Из чего это состоит

- `textarea.js` — `oda-textarea-input` (наследник `oda-block-input`)
- `index.html` — демо: с данными, пустой, только чтение, свёрнутый

## 5. В каком это состоянии

✅ работает (проверено демо `index.html` в браузере).

## 6. Дальнейшие планы

- По мере использования в формах и таблицах.
