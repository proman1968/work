# `oda-markdown-input`

## 1. Что это

Поле markdown: просмотр (`oda-markdown-viewer`) или правка исходника.

## 2. Зачем это нужно

Форматированные тексты в формах.

## 3. Как это работает

Кнопка заголовка переключает «Правка / Просмотр»; выжимка — первый заголовок.

### Контракт для ИИ-агентов

- Тег: `oda-markdown-input`; импорт: `/oda/components/inputs/markdown-input/markdown-input.js` (или `oda//markdown-input`).
- Базовые свойства `oda-input`: `value`, `field`, `readonly`, `disabled`, `required`, `placeholder`, `borderless`, `dense`; методы `validate()`, `focus()`; геттеры `errors`, `isValid`. Изменение значения — событие `value-changed` (двусторонняя привязка `::value`).
- Свойства: `editing`.
- `value`: String (markdown).
- Пример:

```html
<oda-markdown-input ::value="doc"></oda-markdown-input>
```

## 4. Из чего это состоит

- `markdown-input.js` — `oda-markdown-input` (наследник `oda-block-input`)
- `index.html` — демо: с данными, пустой, только чтение, свёрнутый

## 5. В каком это состоянии

✅ работает (проверено демо `index.html` в браузере).

## 6. Дальнейшие планы

- По мере использования в формах и таблицах.
