# `oda-popover`

## 1. Что это

Оболочка всплывающего окна (top layer, нативный popover): заголовок, содержимое, кнопки диалога.

## 2. Зачем это нужно

Единая система диалогов и выпадающих окон библиотеки; `item-popover` WORK — её наследник.

## 3. Как это работает

- Показ, стек и закрытие — `containers.js` (`ODA.showPopover` и обёртки).
- Содержимое — светлый потомок или `message`; закрытие из содержимого — `this.parentElement.close(result)` / `ok()`.
- Esc — отмена; Enter в диалоге — OK; щелчок вне немодальных окон — отмена.

### Контракт для ИИ-агентов

- Свойства: `TITLE {label, icon}`, `OK`, `CANCEL`, `BUTTONS [{label, icon, tap}]` (кнопки — `{…, colorMode}`), `allowClose`, `popoverType` (modal | dialog | dropdown | menu), `message`.
- Геттер `enable` — доступность OK.

## 4. Из чего это состоит

- `popover.js` — `oda-popover`
- `index.html` — демо всех вызовов `ODA.show*`

## 5. В каком это состоянии

✅ работает.

## 6. Дальнейшие планы

- Нативный `<dialog>` для модальных окон (inert фона).
