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

## Не делать

- Сырые `#hex` / `rgba(...)` вместо ролей темы.
- Несуществующие токены вроде `--bg-color`.
- Дублировать `display:flex` / цвета в CSS, если есть attr / `@apply`.
- Копировать этот файл в `.cursor/rules/` — канон только `rules/`.
