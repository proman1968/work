# `oda-form`

## 1. Что это

Иерархическая форма по описаниям полей: строчные поля строкой «подпись | контрол», блочные — на всю ширину, поля с дочерними — сворачиваемые блоки.

## 2. Зачем это нужно

Построитель форм по описаниям полей (заменил старый `oda-form`). `oda-editor-form` (`layouts/editor-form`) пока используется параллельно страницами `objects`/`postings`; их сведение — отдельная задача.

## 3. Как это работает

- Наследник `oda-structure`: `fields`, `data`, `controls`, `readonly`; контрол поля — `controlOf(field)`.
- Блок поля с дочерними — нативный `<details>`; дочерние поля (`getFields(field)`) строятся только в раскрытом блоке, наличие дочерних проверяется только у отрисованных полей — обход ленивый, самоссылки не зацикливают.
- Значения пишутся в `data` (вложенные — в объект `data[field.id]`), событие `field-changed` `{field, value, data}`.
- `validate()` — проверка раскрытых полей, `errors` — `[{field, errors}]`.

### Контракт для ИИ-агентов

- Тег `oda-form`, импорт `/oda/components/structure/form/form.js`; карта контролов — `/oda/components/structure/controls.js` (`CONTROLS`).
- Свойства: `fields`, `data`, `controls`, `readonly`, `dense`, `expanded` (раскрыть первый уровень).
- Переопределяемые методы: `controlOf(field)`, `getFields(field)` (может вернуть Promise), `dataOf(field, data)`, `labelOf(field)`.
- Пример:

```js
form.controls = CONTROLS;
form.fields = [{ id: 'name', required: true }, { id: 'address', fields: [{ id: 'city' }] }];
form.data = {};
```

## 4. Из чего это состоит

- `form.js` — `oda-form`, `oda-form-field`
- `index.html` — демо: типы полей, вложенные блоки, ссылочный тип с ленивой загрузкой, проверка, режимы

## 5. В каком это состоянии

✅ работает (демо, `tests/ui/oda-components.html`).

## 6. Дальнейшие планы

- Раскладка в несколько колонок на широком экране.
- Условная видимость и вычисляемые поля (`expression` — зарезервировано).
