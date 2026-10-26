# REGISTER — журнал проводок

## 1. Что это

Единый журнал организации: план счетов и учёт проводок (двойная запись). Технически — корневой класс типа `$register`; прикладной смысл — баланс и проводки по счетам, к которым у пользователя есть доступ.

## 2. Зачем это нужно

План счетов — не таблица полей и не список в `METADATA.FIELDS`, а **дерево классов типа `$account`**. Так доступ и отчётность совпадают с моделью безопасности WORK: права задаются на уровне класса-счёта; в отчёты попадают только доступные пользователю проводки.

## 3. Как это работает

1. Корень `/MODULES/Register/REGISTER` — журнал (класс `$register`, label «Журнал проводок»).
2. Тип счёта объявлен в meta журнала: [`$folder/$class/$account`](/MODULES/Register/REGISTER/$register/$folder/$class/$account/readme.md/~/handlers/pages/form/) — наследный предок всех счетов (поля, базовый readme).
3. **Счёт** — дочерний класс журнала с **type `$account`**. Имя папки — номер (например `50`), в `$account/class.js` — `label` и **обязательно `icon`** из реального набора ODA (`carbon:`, `icons:`, …; набора `register:` нет). Одна meta на узел: только `$account`.
4. **Субсчёт** — дочерний `$account` у счёта (и глубже). Иерархия папок = план счетов.
5. Добавить счёт/субсчёт — `create` с `type: '$account'`, id = номер, `label` + `icon` в class.js; **не** `$register` и не `$class`. Не правка `FIELDS` у корня журнала.
6. Перед изменением плана — readme журнала и readme типа `$account`, затем **`ls` / `info` ветки `/MODULES/Register/REGISTER` (deep=2)**. Состав счетов **сейчас** — только из ls, не из примеров ниже.
7. `METADATA.FIELDS` у корня журнала — метаданные журнала (не план счетов).
8. Документ журнала — `readme.md` в `$register/`; документ счёта — в его `$account/`.
9. ИИ-агент: рецепт «завести типовой план счетов» — навык [`register-accounts`](/MODULES/Register/REGISTER/$register/ai/skills/register-accounts.md) (виден агенту, работающему в `/MODULES/Register/REGISTER` и ниже).

## 4. Из чего это состоит

- [`class.js`](/MODULES/Register/REGISTER/$register/class.js/~/handlers/pages/form/) — журнал: `label`, `icon`, `METADATA.FIELDS`
- [`readme.md`](/MODULES/Register/REGISTER/$register/readme.md/~/handlers/pages/form/) — устройство журнала (этот документ)
- [`$folder/$class/$account/`](/MODULES/Register/REGISTER/$register/$folder/$class/$account/readme.md/~/handlers/pages/form/) — тип счёта (предок + базовый readme)
- [`ai/skills/`](/MODULES/Register/REGISTER/$register/ai/skills/register-accounts.md) — навыки ИИ-агента места
- Дети `/MODULES/Register/REGISTER` — счета `$account` (номера-папки); актуальный список — только через ls ветки, не фиксируется в этом разделе

## 5. В каком это состоянии

- ✅ корень журнала `$register`
- ✅ тип `$account` (контракт create счетов, аналитики — поля-ссылки с `analytic: true`)
- ✅ проводки, журнал, ОСВ и карточка счёта — учётное ядро ([`sources/data`](/sources/data/readme.md/~/handlers/pages/form/)): формы `form/journal`, `form/sheet` журнала и `form/postings` счёта (методы `db_journal`, `db_sheet`, `db_card`)
- ✅ поле-ссылка `Link`, рабочие места (`LINKS`)
- 🔧 реальный план счетов демо-конфигурации, баланс

## 6. Дальнейшие планы

- Наполнение плана счетов (в т.ч. касса и типовые счета)
- Проводки и отчёты с фильтром по правам на классы счетов
