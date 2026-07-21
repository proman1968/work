# Offerings — услуги платформы WORK

## Что это

Прикладная зона `/Offerings/` с продуктовыми услугами: базовый класс `$offering` (механика заявок) и подкласс `PaaS` (пропоузалы + provision). Технически — `Offerings/$offering/$folder/$class/$offering` + `Offerings/PaaS/$offering/$folder/$class/$offering`; прикладное назначение — каталог услуг, подача заявок клиентами, согласование STAFF, выпуск лицензий и provision.

## Зачем это нужно

Платформа продаёт услуги (PaaS сейчас, другие — позже). Нужен единый процесс: клиент подаёт заявку → STAFF согласует → система выпускает лицензию и provises ресурс. Offerings集中ует этот процесс и связывает `SYS/Licenses` (права) и `SYS/Billing` (деньги, позже) с прикладным каталогом. Без отдельной зоны заявки расползались бы по `$server/handlers` и связывали бы UI с системным слоем напрямую.

## Как это работает

- **Базовый класс** `Offerings/$offering` — общая механика заявок (`submitRequest`/`approveRequest`/`rejectRequest`/`listRequests`) + `#security` для назначения STAFF. Подкласс наследует и уточняет.
- **PaaS** наследует `$offering` и заменяет «requests» на «proposals»: `submitProposal` → `validateProposal` → `approveProposal` → `provision` (создаёт `/paas/<subdomain>` через core `create`).
- **Связь с SYS:** `approveProposal` вызывает `systemMethod('/SYS/Licenses', 'issue', …)` с `$context` — выпускает лицензию на subdomain. `debit` из Billing не подключён (ждёт pricing).
- **Данные:** `plans.json` в USER `$work` PaaS; proposal-файлы в USER `$work` конкретного offering-экземпляра. Host-хелперы в [`sources/host/offering-paas.js`](/sources/host/offering-paas.js/~/handlers/pages/form/) (без FS-путей к WORK).
- **UI:** `Offerings/PaaS/$offering/handlers/pages/orders/` — очередь заявок для STAFF; site/main ссылается на `/Offerings/PaaS` для каталога.

## Из чего это состоит

- [`$offering/class.js`](/Offerings/$offering/class.js/~/handlers/pages/form/) — базовый класс «Услуги»: icon catalog, label «Услуги»
- [`$offering/$folder/$class/$offering/class.js`](/Offerings/$offering/$folder/$class/$offering/class.js/~/handlers/pages/form/) — distributed тип «Заявки»
- **Базовые методы** (`$offering/$folder/$class/$offering/methods/<name>/$method/class.js`):
  - `submitRequest` — подача заявки (USER)
  - `approveRequest` — согласование (STAFF)
  - `rejectRequest` — отказ (STAFF)
  - `listRequests` — очередь заявок (STAFF)
- [`PaaS/$offering/class.js`](/Offerings/PaaS/$offering/class.js/~/handlers/pages/form/) — подкласс PaaS: icon cloud-pak, label «PaaS»
- **PaaS-методы** (`PaaS/$offering/$folder/$class/$offering/methods/<name>/$method/class.js`):
  - `getPlans` — каталог планов (USER)
  - `getProposalForm` — схема формы заявки (USER)
  - `validateProposal` — валидация (USER)
  - `submitProposal` — подача пропоузала (USER)
  - `approveProposal` — согласование + `SYS/Licenses.issue` + `provision` (STAFF)
  - `rejectProposal` — отказ (STAFF)
  - `listProposals` — очередь пропоузалов (STAFF)
  - `provision` — создание `/paas/<subdomain>` (system)
  - `checkDomain` — проверка доступности subdomain
  - `sendCompletionEmail` — уведомление клиенту
- [`PaaS/$offering/handlers/pages/orders/$handler/class.js`](/Offerings/PaaS/$offering/handlers/pages/orders/$handler/class.js/~/handlers/pages/form/) — UI очереди заявок

## В каком это состоянии

- ✅ базовый `$offering` + PaaS-подкласс (канон дерева)
- ✅ цикл proposal → approve → license → provision
- ✅ site/main → `/Offerings/PaaS` (каталог)
- 🔧 `approveProposal` не вызывает `debit` — ждёт pricing-модель
- 🔧 `checkLimit` (Licenses) не подключён в runtime Offerings

## Дальнейшие планы

- Подключить `debit` в `approveProposal` после определения цен планов.
- Подключить `checkLimit` перед provision (проверка лимитов лицензии).
- Расширить каталог услуг за пределы PaaS (наследники `$offering`).
- UI формы подачи пропоузала на site/main (editor-builder).
