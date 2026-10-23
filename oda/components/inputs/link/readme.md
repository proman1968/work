# `oda-link-input`

## 1. Что это

Ссылка на объект справочника: поле с поиском по имени, список вариантов под ним и кнопка очистки. Значение — `id` объекта.

## 2. Зачем это нужно

Ссылочные поля форм и таблиц (тип `Link`, путь класса в `field.type`), слоты аналитик проводок. Не наследует `oda-input`, поэтому ряд свойств повторяет его вручную.

## 3. Как это работает

Каталог — `meta.catalog` / `field.catalog` / путь в `field.type`. Пока значение найдено в справочнике, поле показывает имя и заперто (смена — кнопка «×»); поиск идёт по `like` на имени с задержкой 300 мс.

### Контракт для ИИ-агентов

- Тег: `oda-link-input`; импорт: `/oda/components/inputs/link/link.js`.
- Свойства: `value` (id, пусто — `undefined`), `meta`, `field`, `readonly`, `disabled`, `borderless`, `dense`.
- `disabled` — обычное булево свойство (атрибут `disabled` тоже работает); отключённое поле не принимает ввод и не показывает «×». `meta.disabled` действует так же. `readonly` — только показ, без выбора и очистки.
- `borderless` / `dense` — как у `oda-input`: без рамки и фона / плотные отступы.
- Геттер `errors` и метод `validate()` — обязательность из `meta.required` / `field.required`.
- Изменение значения — событие `value-changed` (двусторонняя привязка `::value`).
- Пример:

```html
<oda-link-input :field="{type: '/DATA/CATALOGS/C'}" ::value="clientId" borderless></oda-link-input>
```

## 4. Из чего это состоит

- `link.js` — `oda-link-input`

## 5. В каком это состоянии

⚠️ демо-страницы нет; `disabled`/`readonly`/`borderless`/`dense` проверены в headless Chrome на созданном вручную элементе (поиск и выбор из каталога не проверялись — нужен сервер данных).

## 6. Дальнейшие планы

- Демо `index.html` и приведение к `oda-input` (общая рамка, `errors` после `touched`, `placeholderText`, `isReadonly`).
