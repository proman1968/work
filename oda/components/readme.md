# oda/components — библиотека универсальных компонентов ODA

## 1. Что это

Переиспользуемые Web Components на ODA: контролы ввода, формы, таблица, дерево, всплывающие окна, меню, кнопки, иконки, редакторы, раскладки. Прикладное назначение — строительные блоки интерфейса WORK и любых приложений на ODA.

## 2. Зачем это нужно

Один источник визуальных примитивов с единым контрактом и оформлением. Библиотека **не зависит от ядра WORK** (`WORK`, `$item`, `$class`, `CORE`) и **не знает типов данных**: компоненты работают с `data`, `items`, описаниями полей и картой «тип → контрол», которую подаёт потребитель. Системные обёртки, которым нужен `$item`, живут в `$server/$folder/lib/` и наследуют компоненты отсюда (`item-popover`, `item-form`, `item-data-grid`, `item-link-input`).

## 3. Как это работает

- Регистрация, наследование, реактивность, шаблоны — `oda/readme.md` и корневой `readme.md`. Стили — `rules/styles.md`, токены и миксины — `oda/tools/styles/styles.js`.
- Компонент — папка `<категория>/<имя>/<имя>.js` + `readme.md` + `index.html` (демо и визуальный тест). Имена файлов уникальны: импорт `oda//<имя>` ищет файл по имени.
- **Описание поля** (соглашение, не тип библиотеки): `{id, type?, label?, description?, icon?, placeholder?, fields?, items? | options?, required?, readonly?, control?, expression?}`. `fields` — вложенные поля, `items` / `options` — варианты выбора, `control` — явный тег, `expression` — зарезервировано.
- **Карта контролов** — объект `{тип: тег, default: тег}` в свойстве `controls` у формы и таблицы; стандартная — `structure/controls.js`. Приложение подменяет карту (например, тип-путь класса WORK → `item-link-input`).
- **Контролы ввода**: одно свойство `value` (событие `value-changed`, привязка `::value`), `field`, `readonly`, `disabled`, `required`, `validate()`. Строчные — `oda-input`, блочные (строка-заголовок + тело) — `oda-block-input`.
- **Всплывающие окна**: `ODA.showDialog / showModal / showDropdown / showMenu / showConfirm / showPrompt` → Promise; отмена — `ODA.CancelError`.

## 4. Из чего это состоит

| Папка | Назначение |
|---|---|
| `inputs/` | контролы ввода: 16 строчных, 9 блочных, базы `oda-input`, `oda-options-input`, `oda-block-input` |
| `structure/` | `oda-structure` (модель), `controls.js` (карта), `oda-form`, `oda-property-grid` |
| `table/` | `oda-table` |
| `tree/` | `oda-tree` |
| `containers/` | `ODA.show*`, `oda-popover` |
| `menus/` | `oda-menu`, `oda-menu-list` |
| `button/`, `icon/` | `oda-button`, `oda-icon` |
| `editors/` | `oda-code-editor`, `oda-markdown*` |
| `layouts/` | `oda-app-layout`, `oda-splitter`, `oda-tabs`, `oda-hexagon-layout` |
| `index.html` | каталог демо всех категорий |

## 5. В каком это состоянии

✅ Работает; проверки — демо `index.html` каждого компонента, `tests/ui/oda-components.html`, `tests/ui/oda-core.html` (`npm run test:ui`).

Итоги ревизии и унификации:

| Было | Стало |
|---|---|
| три несовместимых контракта полей ввода (`value` / `toggled` / `descriptor.value`, `meta`) | единый контракт `oda-input` / `oda-block-input` |
| `oda-numeric-input` нерабочий (`$next`), `oda-date-input` + `oda-datetime-input` | переписаны; один `oda-date-input` |
| `oda-radio-button`, `oda-secret-code-input`, `checkbox/`, `toggle/` вне `inputs/` | `oda-radio-input`, `oda-otp-input`, `inputs/checkbox`, `inputs/toggle` |
| четыре построителя форм (`oda-form` старый, `oda-editor-form`, `item-editor-form` по метаданным, property-grid на дереве) | `oda-form` + `oda-property-grid` (пресет формы); `oda-editor-form` (`layouts/editor-form`) сохранён — на нём работают страницы `objects`/`postings` (METADATA STATIC/FIELDS, тип `Link`) |
| `oda/tools/containers` не инициализировался (`ODA.show*` не существовали) | `containers/`; `WORK.show*` — те же функции |
| `oda-table`: сортировка и фильтр только в UI, нет контролов ячеек, ширина колонок ломалась, `~html` в ячейке | сортировка, фильтр, контролы по карте, ширина по содержимому, каскадная отметка, мини-форма строки, текст вместо HTML |
| связь с WORK: `oda-icon` (`WORK.renderText`), `tree-icon-selector`, `icons-tree`, `jupyter`, `playground` | отвязано или перенесено в системную часть |
| удалены как нерабочие и без потребителей | `jspreadsheet-editor`, `barcode-scanner`, `layout-designer`, `scheme-layout` (+ `ruler-grid`), `layouts/form`, `radio-button`, `tools/icons/icons.js`, `tools/playground`, `tree-*-editor` |

Известные ограничения:
- 🔧 `oda-table` пишет служебные поля (`level`, `expanded`, `checked`) в строки данных; агрегаты подвала не считаются.
- 🔧 `oda-tree` сохраняет собственные колонки (дубль возможностей таблицы).
- 🔧 Системные страницы редактора класса (`handlers/pages/form/editor`) работают через прежний `item-editor-form` (формат данных `DataAccessNode`).

## 6. Дальнейшие планы

- Лёгкое `oda-tree` без колонок; колоночные потребители — на `oda-table`.
- Состояние строк таблицы вне данных; агрегаты; виртуализация колонок.
- Перевод страницы редактора класса на `item-form`.
- `oda-icon`: `iconColor` → `iconBackground`, `default` → `fallback`.
