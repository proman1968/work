# `oda-media-input, oda-image-input, oda-video-input, oda-audio-input`

## 1. Что это

Медиа по URL: предпросмотр изображения, видео, аудио.

## 2. Зачем это нужно

Фото, видео, звук в карточках объектов.

## 3. Как это работает

Кнопки: выбрать файл, задать URL, открыть, очистить; перетаскивание файла. Изображение из файла — data: URL, видео и аудио — blob: URL (живёт только в текущей вкладке, не сериализуется).

### Контракт для ИИ-агентов

- Тег: `oda-media-input, oda-image-input, oda-video-input, oda-audio-input`; импорт: `/oda/components/inputs/media/media.js` (или `oda//media`).
- Базовые свойства `oda-input`: `value`, `field`, `readonly`, `disabled`, `required`, `placeholder`, `borderless`, `dense`; методы `validate()`, `focus()`; геттеры `errors`, `isValid`. Изменение значения — событие `value-changed` (двусторонняя привязка `::value`).
- Свойства: `kind` (image | video | audio, у тегов-наследников задан).
- `value`: строка URL.
- Пример:

```html
<oda-image-input ::value="photo"></oda-image-input>
```

## 4. Из чего это состоит

- `media.js` — `oda-media-input, oda-image-input, oda-video-input, oda-audio-input` (наследник `oda-block-input`)
- `index.html` — демо: с данными, пустой, только чтение, свёрнутый

## 5. В каком это состоянии

✅ работает (проверено демо `index.html` в браузере).

## 6. Дальнейшие планы

- По мере использования в формах и таблицах.
