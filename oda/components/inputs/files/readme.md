# `oda-files-input`

## 1. Что это

Коллекция файлов списком: тип, имя, размер, удаление.

## 2. Зачем это нужно

Вложения объекта.

## 3. Как это работает

Добавление кнопкой заголовка или перетаскиванием; у добавленных — `url` (blob:) и `file`.

### Контракт для ИИ-агентов

- Тег: `oda-files-input`; импорт: `/oda/components/inputs/files/files.js` (или `oda//files`).
- Базовые свойства `oda-input`: `value`, `field`, `readonly`, `disabled`, `required`, `placeholder`, `borderless`, `dense`; методы `validate()`, `focus()`; геттеры `errors`, `isValid`. Изменение значения — событие `value-changed` (двусторонняя привязка `::value`).
- Свойства: `accept`.
- `value`: Array `{name, size?, type?, url?}`.
- Пример:

```html
<oda-files-input ::value="attachments"></oda-files-input>
```

## 4. Из чего это состоит

- `files.js` — `oda-files-input` (наследник `oda-block-input`)
- `index.html` — демо: с данными, пустой, только чтение, свёрнутый

## 5. В каком это состоянии

✅ работает (проверено демо `index.html` в браузере).

## 6. Дальнейшие планы

- По мере использования в формах и таблицах.
