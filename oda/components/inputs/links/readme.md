# `oda-links-input`

## 1. Что это

Коллекция ссылок: подпись и URL.

## 2. Зачем это нужно

Ссылки на внешние ресурсы.

## 3. Как это работает

Добавление и правка — `ODA.showPrompt`.

### Контракт для ИИ-агентов

- Тег: `oda-links-input`; импорт: `/oda/components/inputs/links/links.js` (или `oda//links`).
- Базовые свойства `oda-input`: `value`, `field`, `readonly`, `disabled`, `required`, `placeholder`, `borderless`, `dense`; методы `validate()`, `focus()`; геттеры `errors`, `isValid`. Изменение значения — событие `value-changed` (двусторонняя привязка `::value`).
- `value`: Array `{url, label?}`.
- Пример:

```html
<oda-links-input ::value="links"></oda-links-input>
```

## 4. Из чего это состоит

- `links.js` — `oda-links-input` (наследник `oda-block-input`)
- `index.html` — демо: с данными, пустой, только чтение, свёрнутый

## 5. В каком это состоянии

✅ работает (проверено демо `index.html` в браузере).

## 6. Дальнейшие планы

- По мере использования в формах и таблицах.
