# `oda-file-input`

## 1. Что это

Строчный выбор файлов: кнопка, имена с размером, перетаскивание.

## 2. Зачем это нужно

Прикрепление файла к полю формы.

## 3. Как это работает

Диалог — `ODA.showFileDialog`; перетаскивание на контрол.

### Контракт для ИИ-агентов

- Тег: `oda-file-input`; импорт: `/oda/components/inputs/file/file.js` (или `oda//file`).
- Базовые свойства `oda-input`: `value`, `field`, `readonly`, `disabled`, `required`, `placeholder`, `borderless`, `dense`; методы `validate()`, `focus()`; геттеры `errors`, `isValid`. Изменение значения — событие `value-changed` (двусторонняя привязка `::value`).
- Свойства: `multiple`, `accept` (или `field.accept`).
- `value`: File (Array<File> при `multiple`).
- Пример:

```html
<oda-file-input accept="image/*"></oda-file-input>
```

## 4. Из чего это состоит

- `file.js` — `oda-file-input`
- `index.html` — демо: обычное, только чтение, отключено, проверка

## 5. В каком это состоянии

✅ работает (проверено демо `index.html` в браузере).

## 6. Дальнейшие планы

- По мере использования в формах и таблицах.
