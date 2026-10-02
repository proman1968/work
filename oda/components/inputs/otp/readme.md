# `oda-otp-input`

## 1. Что это

Ввод одноразового кода по цифрам (заменил `oda-secret-code-input`).

## 2. Зачем это нужно

Подтверждение e-mail / входа (`user-profile`).

## 3. Как это работает

Автопереход, Backspace, вставка кода целиком; при заполнении — событие `complete`.

### Контракт для ИИ-агентов

- Тег: `oda-otp-input`; импорт: `/oda/components/inputs/otp/otp.js` (или `oda//otp`).
- Базовые свойства `oda-input`: `value`, `field`, `readonly`, `disabled`, `required`, `placeholder`, `borderless`, `dense`; методы `validate()`, `focus()`; геттеры `errors`, `isValid`. Изменение значения — событие `value-changed` (двусторонняя привязка `::value`).
- Свойства: `length` (6).
- `value`: строка цифр; событие `complete` (detail.value — код).
- Пример:

```html
<oda-otp-input length="6" @complete="onCode"></oda-otp-input>
```

## 4. Из чего это состоит

- `otp.js` — `oda-otp-input`
- `index.html` — демо: обычное, только чтение, отключено, проверка

## 5. В каком это состоянии

✅ работает (проверено демо `index.html` в браузере).

## 6. Дальнейшие планы

- По мере использования в формах и таблицах.
