# oda/components/containers — Всплывающие окна

## 1. Что это

Стек всплывающих окон (`containers.js`: `ODA.showPopover`, `showDialog`, `showModal`, `showDropdown`, `showMenu`, `showConfirm`, `showPrompt`, `ODA.CancelError`) и оболочка `oda-popover`. Приложение подменяет `ODA.popoverTag` / `ODA.menuTag` своими наследниками.

## 2. Зачем это нужно

Группирует компоненты одного назначения; демо категории — `index.html` (все демо рядом).

## 3. Как это работает

Каждый компонент — папка `<имя>/<имя>.js` с `readme.md` и `index.html`.

## 4. Из чего это состоит

- `popover/` — `oda-popover` — оболочка окна

## 5. В каком это состоянии

✅ работает.

## 6. Дальнейшие планы

- Развитие по реестру `oda/components/readme.md`.
