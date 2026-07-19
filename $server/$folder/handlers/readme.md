# $server/$folder/handlers/ — страницы и формы

Обработчики страниц и форм, доступные каждому элементу через `~/handlers/`.

## Структура

- `methods/` — серверные методы (legacy, не для нового кода)
- `pages/` — страницы и формы элементов

## pages/

Структура: `pages/form/имя/$handler/class.js`

Каждый `$handler` — ODA-компонент с `template`, `imports`, свойствами и методами. Выполняется в браузере.

Примеры:
- `pages/form/$handler/` — форма по умолчанию (выбор формы из class.js)
- `pages/form/chat/$handler/` — чат-интерфейс
- `pages/form/folder/$handler/` — форма папки
- `pages/site/` — витрина класса (вкладки + iframe); см. [pages/site/readme.md](/$server/$folder/handlers/pages/site/readme.md/~/handlers/pages/form/)

## Вызов

Страница открывается по URL: `/путь/к/элементу/~/handlers/pages/form/имя/`
Сервер подставляет значения в `page.html`, браузер загружает ODA-компонент.