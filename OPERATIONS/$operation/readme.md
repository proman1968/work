# OPERATIONS — операции и разноска

## 1. Что это

Классы фактов деятельности и правил их разноски по счетам. Технически — корневой класс типа `$operation`; прикладное — продажа, оплата, письмо и любая другая операция, которая проводится в журнал проводками.

## 2. Зачем это нужно

Операция отделена от проводок: человек или агент вводит факт один раз, а двойную запись строит `post` по декларативным правилам. Правила проверяются до записи, частичная разноска откатывается.

## 3. Как это работает

1. Корень `/OPERATIONS` — контейнер операций (класс `$operation`).
2. Тип операции объявлен в meta корня: `$folder/$class/$operation/` — методы `post` / `unpost`, общие для всех операций.
3. **Операция** — дочерний класс корня с **type `$operation`**: `create` с `type: '$operation'`, в `class.js` — `label`, поля и правила.
4. Поля операции — `METADATA.FIELDS` в `class.js` операции. Ссылки на справочники — `type: 'Link'`, `catalog` — путь справочника; значение — id объекта.
5. Правила разноски — `METADATA.POSTINGS`: `{ id, amount, quantity?, debit: { account, analytics }, credit: { account, analytics } }`. `amount`/`quantity` — число или имя поля операции; `analytics` — пары «слот счёта ← поле операции».
6. `post({ id })` проверяет счета (существуют, тип `$account`, листы) и связку слотов, пишет 2×N проводок с общим `entry` и ставит `posted` в операцию. Ошибка на любом шаге — созданное удаляется.
7. `unpost({ id, mode })`: `storno` (по умолчанию) — зеркальные записи с минусом; `replace` — удаление записей. Затем `posted: null`.
8. Время проводки равно времени операции — проводка попадает в пакет дня операции.

## 4. Из чего это состоит

- [`class.js`](/OPERATIONS/$operation/class.js/~/handlers/pages/form/) — корень: `label`, `icon`
- [`$folder/$class/$operation/class.js`](/OPERATIONS/$operation/$folder/$class/$operation/class.js/~/handlers/pages/form/) — тип: `post`, `unpost`, проверки счетов и слотов (`ACCESS: post/unpost — write`)
- [`readme.md`](/OPERATIONS/$operation/readme.md/~/handlers/pages/form/) — это руководство
- Дети `/OPERATIONS` — операции `$operation`; у каждой — свой `class.js` с `FIELDS` и `POSTINGS`

## 5. В каком это состоянии

- ✅ корень `$operation` и тип с `post`/`unpost`
- ✅ проверка счетов, слотов и ссылок; компенсация частичной разноски
- ✅ `storno` и `replace`
- 🔧 автоматическая разноска по триггеру (вручную — работает)

## 6. Дальнейшие планы

- `POSTING_MODE: 'auto'` — триггер `on_save` в классе операции
- Составные операции и пакетное проведение
- Пример конфигурации — `tests/accounting.test.js`
