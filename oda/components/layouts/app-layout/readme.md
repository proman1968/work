# `oda-app-layout`

## 1. Что это

Каркас приложения: слоты header, top, left/right panel (с вкладками и сплиттером), main, bottom, footer.

## 2. Зачем это нужно

Оболочка страниц WORK (explorer, формы, builder, почта, календарь).

## 3. Как это работает

Боковая панель — `app-layout-drawer`, ширина — `oda-splitter`; масштаб Ctrl+колесо.

### Контракт для ИИ-агентов

- Тег `oda-app-layout` (обычно `extends`); слоты `header`, `top`, `left-panel`, `right-panel`, `main`, `bottom`, `footer`; свойства `allowZoom`, `zoom`.

## 4. Из чего это состоит

- `app-layout.js` — `oda-app-layout`, `app-layout-toolbar`, `app-layout-drawer`, `app-tabs`
- `index.html`

## 5. В каком это состоянии

✅ работает.

## 6. Дальнейшие планы

- По реестру `oda/components/readme.md`.
