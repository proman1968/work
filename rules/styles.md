# Стили ODA (для агентов)

Когда правите UI (ODA-компоненты, form handlers, локальный `<style>`) — опирайтесь на системные стили, не изобретайте палитру.

## Источники

| Что | Где |
|-----|-----|
| Токены и mixins | [`oda/tools/styles/styles.js`](/oda/tools/styles/styles.js/~/handlers/pages/form/) |
| Справочник и паттерны | [`oda/tools/styles/README.md`](/oda/tools/styles/README.md/~/handlers/pages/form/) |

## Порядок выбора

1. **Атрибут** в разметке: `horizontal`, `vertical`, `flex`, `no-flex`, `center`, `header`, `content`, `light`, `dark`, `border`, `warning`, `error`, `success`, …
2. **Одна динамическая роль** — `:color-mode` (свойство `colorMode` = имя mixin’а); не несколько конкурирующих `:light` / `:accent` / …
3. **`@apply --имя`** в `<style>` компонента, если нужен mixin на `:host` / классе.
4. **CSS-переменная** темы: `var(--border-color)`, `var(--header-background)`, `var(--error-color)`, … — без hex/rgba-fallback.
5. Локальный CSS — только то, чего нет в системе (`overflow`, `gap`, `border-radius`, ellipsis).

## Когда что

| Задача | Средство |
|--------|----------|
| Ряд кнопок / toolbar | `horizontal` (+ `header` при необходимости), кнопки `no-flex` |
| Колонка контента | `vertical` + `flex` |
| Панель / поле | `content` + `border` |
| Шапка панели | `header` / `dark` |
| Статус | attrs `info` / `success` / `warning` / `error` (+ `-invert`) |
| Переключаемая роль | `:color-mode` → `colorMode` (генерируется из mixin в `styles.js`) |
| Заполнить родителя | `flex` на себе; родитель уже `flex` + `vertical`/`horizontal` |
| Зафиксировать блок | `no-flex` (кнопки, промптбар, сплиттер) |

## Раскладка

Родитель даёт размер и ось. У preview chat-item уже ставит на хост `flex vertical` — **не** перебивать `:host { @apply --horizontal }`: глобальный `[vertical]` выиграет, дети встанут в колонку. Ряд — внутренний `div horizontal flex`.

`--flex` = `flex-basis: auto`: ряд без `overflow: hidden` раздувается контентом боковой панели, низ колонки (`no-flex` панель) уходит под обрез хоста. Боковая панель в ряду — `no-flex`, ширина сплиттера, не второй `flex`.

Не задавать `height: 100%` / `width: 100%` / свои `px` «чтобы заработало».

```html
:host { overflow: hidden; }

<div horizontal flex style="overflow: hidden;">
    <div flex vertical>
        <div flex vertical style="overflow: hidden;"></div>
        <microchat-panel no-flex></microchat-panel>
    </div>
    <oda-splitter></oda-splitter>
    <microchat-dock no-flex></microchat-dock>
</div>
```

Ширина сплиттера — его `::width` / `min`, не `min-width` в нашем CSS.

## Не делать

- Сырые `#hex` / `rgba(...)` вместо ролей темы.
- Несуществующие токены вроде `--bg-color`.
- Дублировать `display:flex` / цвета в CSS, если есть attr / `@apply`.
- `height: 100%` / `width: 100%` / `min-height: 0` / магические `px` вместо `flex` / `no-flex`.
- Локальные `.col` / `.pane` только ради `display:flex`, если хватает attrs `vertical flex`.
- Копировать этот файл в `.cursor/rules/` — канон только `rules/`.
