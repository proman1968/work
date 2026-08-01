# $bid — заявка

## 1. Что это

Тип файла `.bid` — базовая заявка на покупку позиции витрины (`MARKET`). JSON со статусом, снимком продукта и ответами формы.

## 2. Зачем это нужно

Единый артефакт «хочу купить» для любых товаров витрины. Исполнение (provision и т.п.) подключается отдельно через сервисы (например ArgoCD PaaS → `pass.order`).

## 3. Как это работает

1. Витрина MARKET собирает `input` по схеме **`$bid.FIELDS` → `input.fields`** (не из `.product`, не дублируя список в handler категории). У PAAS в схеме — `domainName` / «Имя домена».
2. Клиент сохраняет `{uid}.bid` через `save_file` на ближайший `$class` категории (например `/MARKET/PAAS`) по роли покупателя. Имя файла — `uid` пользователя: одна актуальная заявка на пользователя; повторный заказ перезаписывает файл, предыдущие версии — в `history` + `data.logs` (канон §1.6).
3. Тело только: `status`, `product` (снимок + `$Link` на `.product`), `input` (у PAAS — `{ domainName }`). Без `role` / `buyer` / `created` / `target`.
4. После save витрина вызывает `submitOrder` с `$Link` на `.bid` и тем же снимком.
5. Preview показывает JSON заявки.

## 4. Из чего это состоит

- `class.js` — схема FIELDS: `status`, `product` (`object`), `input` (`form` с `domainName`)
- `triggers/on_save` — no-op в MVP
- `handlers/preview` — просмотр заявки

Поля `$Link` / label / price / description внутри `product` в схеме типа не перечисляются — они есть в runtime JSON.

## 5. В каком это состоянии

- ✅ Схема и preview
- ✅ Создание из MARKET/PAAS + submitOrder
- ✅ Витрина читает `input.fields` из типа `$bid`
- ❌ Реакции on_save / approve-reject в самом `$bid`

## 6. Дальнейшие планы

- Статусы approve/reject на стороне заявки
- Хуки исполнения по типу товара
