# oda/tools — инструменты ODA

## 1. Что это

Служебные модули фреймворка: системные стили, библиотеки иконок, стенд проверки компонентов, ноутбук jupyter.

## 2. Зачем это нужно

Стили и иконки — основа внешнего вида всех компонентов; стенд `oda-tester` — ручная проверка компонента с инспектором свойств.

## 3. Как это работает

Подключаются как компоненты (`imports`). `oda/oda.js` автоматически подключает `tester`, если первый элемент страницы — `<oda-tester>`.

## 4. Из чего это состоит

| Папка | Теги | Назначение |
|---|---|---|
| `styles/` | — | тема, токены, миксины, атрибуты (`styles.js`, `README.md`) |
| `icons/` | `oda-icons-test`, `oda-icons-set`, `oda-icons-tree` | SVG-библиотеки (`lib/`), индекс (`lib-index.js`, `ICON_LIBS`), браузер иконок (`index.html`) |
| `tester/` | `oda-tester`, `oda-tester-container`, `work-tester`, `oda-device-preview` | стенд: компонент + `oda-property-grid`, предпросмотр в рамке устройства |
| `jupyter/` | `oda-jupyter` и вспомогательные | редактор и исполнитель `.ipynb`; выбор файла ячейки — переопределяемый `selectFileUrl` (WORK — `item-jupyter` в `$ipynb`) |
| `jupyter-compare/` | `oda-jupyter-compare` | сравнение ноутбуков |

## 5. В каком это состоянии

- ✅ `styles/`, `icons/`, `tester/` — работают, связей с WORK нет.
- 🔧 `jupyter/` — используется `$ipynb`; дубли ключей в `oda-jupyter-cell`, `oda-jupyter-tree` не определён.
- 🧪 `jupyter-compare/` — без обработки ошибок загрузки.
- Удалены: `containers/` (не инициализировался; заменён `components/containers`), `playground/` (зависел от WORK; заменён каталогом `oda/index.html`), `property-grid/` (перенесён в `components/structure`), `icons/icons.js` (нерабочий).

## 6. Дальнейшие планы

- Исправить `oda-jupyter-cell` (дубли ключей) и `oda-jupyter-tree`.
