# $account — счёт плана счетов

## 1. Что это

Тип счёта (и субсчёта) журнала `/REGISTER`. Наследный предок для всех узлов плана счетов: номер = id папки, название = `label` в `class.js`.

## 2. Зачем это нужно

Отделить **журнал** (`$register`) от **счетов** (`$account`). Одна meta-папка `$account` на узел — тип и хранилище (`storage_folder`). Права и отчёты завязаны на классы счетов.

## 3. Как это работает

1. Объявление типа — этот класс в meta журнала: `REGISTER/$register/$folder/$class/$account/`.
2. Создать счёт: `create` у родителя (`/REGISTER` или родительский счёт), **type: `$account`**, id = номер (`50`, `5001`), в `class.js` — обязательно `label` и `icon`.
3. **icon** — всегда в class.js, только реальные наборы ODA: `carbon:`, `icons:`, `ai:`, `lineawesome:`, `bootstrap:`, `iconoir:`, `editor:`. Набора `register:` нет. Касса — `carbon:wallet` или icon предка `carbon:data-base`.
4. Субсчёт — тот же `$account` ребёнком счёта.
5. На узле допустима **только одна** meta `$account` (не `$class` и не `$register` рядом).
6. Документ счёта — `readme.md` в `$account/` (`storage_folder`). Базовый контракт — этот readme; у конкретного счёта — свой поверх.

## 4. Из чего это состоит

- [`class.js`](/REGISTER/$register/$folder/$class/$account/class.js/~/handlers/pages/form/) — предок: icon, label, `METADATA.FIELDS` (`label`, `icon`)
- [`readme.md`](/REGISTER/$register/$folder/$class/$account/readme.md/~/handlers/pages/form/) — базовый документ типа (этот файл)

## 5. В каком это состоянии

- ✅ тип `$account` в meta журнала
- ✅ счета плана — дерево `$account`
- 🔧 проводки по счетам

## 6. Дальнейшие планы

- Поля аналитики / валюты в FIELDS при появлении проводок
