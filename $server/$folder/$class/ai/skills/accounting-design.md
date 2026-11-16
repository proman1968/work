---
name: accounting-design
description: Проектирование учётной модели WORK — план счетов ($register, $account), слоты аналитик (ANALYTICS), операции ($operation, NUMERATOR, AUTO_REGISTER), правила двойной записи (POSTINGS) и виртуальные справочники.
---
# Проектирование учётной модели

1. **План счетов (`$register` → `$account`):**
   - Внутри модуля учёта (`/ORGANIZATIONS/<Орг>/MODULES/Register/REGISTER/...`) групповые счета могут иметь субсчета (`$account`), но проводки допустимы **только на счетах-листьях**.
   - Слоты аналитик на счёте задаются в `METADATA.FIELDS` как поля типа `link` с `analytic: true` и `target: '<путь к $catalog или $virtual>'` (например `counterparty`, `item`, `warehouse`, `employee`).
   - Поля справочника-аналитики автоматически работают как субаналитики в отчётах (`report`).
2. **Операции (`$operation`):**
   - Определяй шапку документа (`num`, `contractor`/`warehouse` и т.д.) и при необходимости табличную часть (`table: true` со ссылкой на `$struct`).
   - Настрой `NUMERATOR` (`{ field: 'num', reset: 'year', pad: 4, prefix: '...' }`) и при необходимости `AUTO_REGISTER: true` через `update_class`.
3. **Правила проводок (`METADATA.POSTINGS`):**
   - Каждое правило имеет уникальный `id`, опционально `each: '<table_field_id>'` (построчное проведение по табличной части, внутри доступны `row.<поле>`) и условие `when`.
   - Задай `amount` и при количественном учёте `qty` (плюс при пересчёте единиц измерения `unit` и `item` — ядро пересчитает по коэффициенту номенклатуры).
   - Укажи `debit: { account: '<лист $account>', analytics: { <slot>: '<выражение>' } }` и `credit: { account: '<лист $account>', analytics: { ... } }`.
   - Все слоты `analytic: true` счетов Дебета и Кредита обязаны быть сопоставлены в `analytics`!
4. **Проверка целостности и пробный прогон:**
   - Вызови `describe_class` и `inspect_class_tree`: убедись, что `checkSchema` не выдаёт ни одной ошибки в `POSTINGS`, счетах-листьях и выражениях.
   - По согласованию сделай пробный предпросмотр `register_operation` с `preview=true` и проверь баланс Дт/Кт и аналитики.
