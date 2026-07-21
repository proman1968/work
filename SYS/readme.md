# SYS — системный слой WORK

## Что это

Защищённая корневая зона `/SYS/` с системными классами организации: кошелёк (Billing) и лицензии (Licenses). Технически — `$sys` с дочерними `$billing`/`$licenses`; прикладное назначение — хранить критичные системные данные, доступ к которым ограничен на уровне движка.

## Зачем это нужно

Системные данные (баланс организации, ключи лицензирования, проводки) не должны быть доступны прикладным пользователям и не должны писаться администраторами вручную. `/SYS/` выделяет для них отдельную PROTECTED-зону: чтение — только root ADMIN, запись — только `globalThis.WORK` через `$method`. Это гарантирует, что кошелёк и лицензии меняются исключительно через системные методы, а не прямым редактированием файлов.

## Как это работает

- **PROTECTED-зона** реализована в [`sources/server/class.js`](/sources/server/class.js/~/handlers/pages/form/) — `_isSysProtectedPath` срабатывает для `/SYS` и `/SYS/…`; `resolveZone` возвращает `ZONES.PROTECTED`; `canSee` пускает только WORK или `_isWorkAdmin`; `canWrite` — только `params.user === globalThis.WORK`; `allowAccess` WRITE для work-admin в `/SYS/` бросает ошибку. Покрыто тестами [`tests/class/sys-protected.test.js`](/tests/class/sys-protected.test.js/~/handlers/pages/form/).
- **Данные — через ядро:** wallet/usage/tx/`.lic` лежат в `$work` ADMIN-зоны классов; методы читают/пишут через `save_file` / `get_storage` (обёртка [`sources/host/billing-store.js`](/sources/host/billing-store.js/~/handlers/pages/form/)), не обращаясь к FS напрямую.
- **Host-модули** (`sources/host/licenses.js`, `yookassa.js`, `billing-store.js`, `stats-collector.js`) — crypto/HTTP/helpers без путей к WORK; `loadHost` подгружает их через `pathToFileURL`.
- **Системные методы** принимают `params.user === globalThis.WORK` (write) или `requireWorkAdmin` (read); `$context` указывает на класс-владелец.

## Из чего это состоит

- [`$sys/class.js`](/SYS/$sys/class.js/~/handlers/pages/form/) — класс `$sys`: иконка, label «SYS», описание (корень системного слоя)
- [`Billing/`](/SYS/Billing/~/handlers/pages/form/) — org-кошелёк, ЮKassa, usage (см. локальный readme)
- [`Licenses/`](/SYS/Licenses/~/handlers/pages/form/) — выдача `.lic`, ключи в `#system` (см. локальный readme)

## В каком это состоянии

- ✅ PROTECTED-зона `/SYS/` (canSee/canWrite/allowAccess + тесты)
- ✅ Billing: wallet, topUp, creditWallet, debit, usage, dashboard UI
- ✅ Licenses: issue, verify, renew, getActive, checkLimit, boot-check
- 🔧 `debit` без callers — отложен до фазы pricing
- 🔧 `wallet.json`/`*.tx.json` — временный мини-ledger, миграция в `register/` после его готовности

## Дальнейшие планы

- Pricing-модель: цена плана, тариф за запрос/AI → подключение `debit` в `approveProposal` и `stats-collector`.
- Мост Billing → `register/`: tx-файлы как проводки двойной записи.
- Гибридный режим лицензий (вариант D из плана SYS Section Architecture): внешний подписчик + self-sign.
