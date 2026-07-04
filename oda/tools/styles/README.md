# Система стилизации ODA

Глобальные стили задаются в [`styles.js`](styles.js) и подключаются ко всем ODA-компонентам через adoptedStyleSheets.

## Тема: одна точка — `--main-color`

На `:root` задан базовый цвет темы. Все роли (header, content, light, accent, …) **выводятся** из него через `oklch(from var(--main-color) …)` и переключаются светлая/тёмная схема через `light-dark()`.

```css
:root {
    --main-color: indigo;   /* смена темы — только эта переменная */
}
```

Не задавайте в компонентах собственные `#fff`, `rgba(0,0,0,.1)` и т.п., если задачу решает семантический класс (`content`, `light`, `accent-invert`, …).

## Mixins и `@apply`

Правило в `:root` с именем `--имя` и телом `{ … }` — **mixin**. В `<style>` компонента:

```css
:host {
    @apply --vertical;
    @apply --flex;
}
.toolbar {
    @apply --horizontal;
    @apply --header;
}
```

`extractCSSRules` разворачивает `@apply` и регистрирует mixin в `cssRules`.

## Атрибуты разметки (= классы темы и layout)

Каждый mixin автоматически становится **и классом, и булевым атрибутом**:

```css
/* из --horizontal генерируется: */
.horizontal, [horizontal] { display: flex; flex-direction: row; }
```

В шаблоне ODA предпочтительно писать **атрибуты**, без лишних `class`:

```html
<div vertical flex>
    <div horizontal>
        <textarea flex class="prompt" ::value></textarea>
        <div vertical no-flex center>
            <oda-button round accent-invert icon="…"></oda-button>
        </div>
    </div>
</div>
```

### Layout

| Атрибут | Назначение |
|---------|------------|
| `horizontal` | flex-row |
| `vertical` | flex-column |
| `flex` | растягивание (`flex: 1`) |
| `no-flex` | фиксированный блок (кнопки, иконки) |
| `center` | выравнивание по центру |
| `between` | `justify-content: space-between` |
| `horizontal-center` | row + `align-items: center` |

### Семантика цвета (роли)

| Атрибут | Когда использовать |
|---------|-------------------|
| `header` | верхние панели, заголовки |
| `content` | основной фон и текст (карточки, поля ввода) |
| `light` | вторичный/приглушённый фон внутри карточки |
| `dark` | контрастные блоки |
| `layout` | фон страницы / оболочки |
| `accent` / `accent-invert` | акцентные кнопки, чипы, pill |
| `info`, `success`, `warning`, `error` | статусы (+ `-invert` для инверсии) |

### Обрамление и состояние

| Атрибут | Назначение |
|---------|------------|
| `border` | рамка `var(--border-color)` |
| `raised` | лёгкая тень |
| `shadow` | объёмная тень |
| `hoverable` | hover-подсветка |
| `disabled` | неактивный вид |
| `selected` | выделение |

Компоненты `oda-button` / `oda-icon` поддерживают те же атрибуты (`round`, `content`, `accent-invert`, …).

## Паттерн: панель ввода (prompt)

Адаптивная раскладка **без абсолютных размеров контейнера** — только flex-атрибуты и семантические цвета.

```html
<div vertical class="prompt-wrap">
    <!-- вложения -->
    <div horizontal style="flex-wrap: wrap; gap: 4px; padding: 8px 12px 0;" ~if="files.length">
        <div ~for="files" horizontal accent-invert no-flex class="attach-chip">
            <oda-icon icon-size="16" :icon="…"></oda-icon>
            <label flex>{{$for.item.name}}</label>
            <oda-button icon-size="14" icon="icons:close"></oda-button>
        </div>
    </div>
    <!-- поле + кнопки -->
    <div horizontal content border raised class="prompt-box">
        <textarea flex class="prompt" ~if="!recording" ::value></textarea>
        <div vertical no-flex center>
            <oda-button round accent-invert :icon="sendIcon"></oda-button>
            <oda-button icon="unicon:paperclip"></oda-button>
        </div>
    </div>
</div>
```

Локальный `<style>` компонента — только то, чего нет в mixins:

- `border-radius`, `overflow`, `min-height` textarea;
- `text-overflow: ellipsis` для длинных имён файлов;
- **не** дублировать `display:flex`, `background`, `color`.

Образец: [`$server/$folder/$file/$ai/handlers/preview/$handler/data.js`](../../../$server/$folder/$file/$ai/handlers/preview/$handler/data.js).

## Паттерн: карточка / bubble

```html
<div class="card" raised vertical content>
    <div class="body" vertical light>
        …
    </div>
</div>
```

Исходящее сообщение: `header` на preview-комponente; входящее: `content` на `.card` и preview.

## Паттерн: toolbar

```html
<div horizontal class="toolbar">
    <oda-button no-flex icon="…"></oda-button>
    <div flex center>…</div>
    <oda-button no-flex icon="…"></oda-button>
</div>
```

## Чего избегать

1. **Жёсткие размеры** (`width: 320px`, `height: 36px`) там, где достаточно `flex` / `no-flex`.
2. **Сырые цвета** вместо `content`, `accent-invert`, `var(--border-color)`.
3. **Дублирование flex** в CSS, если есть `horizontal` / `vertical`.
4. **Inline-стили** для темы (`style="background:#fff"`) — только для редких layout-исключений (`marginLeft: auto` для выравнивания bubble).
5. **Новые mixins в компоненте** для одноразовых цветов — расширять `:root` в `styles.js`, если паттерн повторяется.

## Поля ввода

Глобально `input` / `textarea` наследуют `--content-background` и `--content-color`. Внутри themed-контейнера (`content border`) достаточно:

```css
.prompt {
    border: none;
    outline: none;
    resize: none;
    background: transparent;
    min-width: 0;
    @apply --flex;
}
```

Placeholder наследует цвет с `opacity: .5` (см. `styles.js`).

## API модуля

```js
import styles from '/oda/tools/styles/styles.js';

styles.cssRules      // развёрнутые mixins
styles.adopted       // Constructable Stylesheets для shadow DOM
styles.extractCSSRules(styleText)
styles.applyStyleMixins(text)
```

## Связанные файлы

- [`styles.js`](styles.js) — палитра, mixins, генерация `[attr]`-правил
- [`adoptedStyleSheets.js`](adoptedStyleSheets.js) — проброс в shadow root
- [`.cursor/rules/oda-ui-refactoring.mdc`](../../../.cursor/rules/oda-ui-refactoring.mdc) — чеклист рефакторинга форм WORK
