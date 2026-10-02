# `oda-gallery-input`

## 1. Что это

Коллекция медиа: текущий элемент крупно, лента миниатюр.

## 2. Зачем это нужно

Галереи фото и видео объекта.

## 3. Как это работает

Заголовок: «2 из 5 · имя», кнопки пред. / след., добавить, удалить; клавиши ← / →.

### Контракт для ИИ-агентов

- Тег: `oda-gallery-input`; импорт: `/oda/components/inputs/gallery/gallery.js` (или `oda//gallery`).
- Базовые свойства `oda-input`: `value`, `field`, `readonly`, `disabled`, `required`, `placeholder`, `borderless`, `dense`; методы `validate()`, `focus()`; геттеры `errors`, `isValid`. Изменение значения — событие `value-changed` (двусторонняя привязка `::value`).
- Свойства: `index`.
- `value`: Array `{src, type?, name?}` или строк-URL.
- Пример:

```html
<oda-gallery-input ::value="photos"></oda-gallery-input>
```

## 4. Из чего это состоит

- `gallery.js` — `oda-gallery-input` (наследник `oda-block-input`)
- `index.html` — демо: с данными, пустой, только чтение, свёрнутый

## 5. В каком это состоянии

✅ работает (проверено демо `index.html` в браузере).

## 6. Дальнейшие планы

- По мере использования в формах и таблицах.
