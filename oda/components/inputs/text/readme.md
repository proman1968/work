# `oda-text-input`

## 1. Что это

Строчный ввод текста на нативном `input`: text, password (с показом), email, url, tel, search.

## 2. Зачем это нужно

Основной строчный контрол.

## 3. Как это работает

Тип — `inputType`, иначе `field.type` (если это тип текста). Формат (email, url, `pattern`) проверяется нативно; кнопка очистки — `clearable`.

### Контракт для ИИ-агентов

- Тег: `oda-text-input`; импорт: `/oda/components/inputs/text/text.js` (или `oda//text`).
- Базовые свойства `oda-input`: `value`, `field`, `readonly`, `disabled`, `required`, `placeholder`, `borderless`, `dense`; методы `validate()`, `focus()`; геттеры `errors`, `isValid`. Изменение значения — событие `value-changed` (двусторонняя привязка `::value`).
- Свойства: `inputType`, `pattern`, `autocomplete`, `clearable`; из поля — `minLength`, `maxLength`, `pattern`.
- `value`: String.
- Пример:

```html
<oda-text-input input-type="email" clearable></oda-text-input>
```

## 4. Из чего это состоит

- `text.js` — `oda-text-input`
- `index.html` — демо: обычное, только чтение, отключено, проверка

## 5. В каком это состоянии

✅ работает (проверено демо `index.html` в браузере).

## 6. Дальнейшие планы

- По мере использования в формах и таблицах.
