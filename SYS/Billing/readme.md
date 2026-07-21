# Billing — кошелёк организации

## Что это

Системный класс `$billing` в PROTECTED-зоне `/SYS/Billing`: внутренний кошелёк организации с пополнением через ЮKassa и учётом использования. Технически — `$billing/$folder/$class/$billing` с методами + dashboard; прикладное назначение — единый счёт, с которого списывается потребление ресурсов (AI, трафик, услуги).

## Зачем это нужно

Любая платформа, продающая услуги, должна считать деньги: пополнения, списания, остаток. Billing集中ует это в одном защищённом месте: администратор видит баланс и метрики, внешние системы (ЮKassa, StatsCollector, Offerings) меняют состояние только через системные методы. Без отдельного кошелька расходились бы ручные таблицы и нет доверия к цифрам.

## Как это работает

- **Пополнение:** root ADMIN вызывает `topUp` → создаётся платёж в ЮKassa (`sources/host/yookassa.js`) + `pending`-файл; пользователь перенаправляется на `confirmation_url`.
- **Зачисление:** webhook `POST /api/billing/yookassa/webhook` → `creditWallet` всегда делает `getPayment` к API ЮKassa, сверяет статус и сумму с `pending`, затем увеличивает `wallet.balance` и пишет tx-файл. Дедупликация по `yk_<paymentId>.tx.json`.
- **Списание:** `debit` (system only) — уменьшает `wallet.balance`, проверяет достаточность, пишет tx. Сейчас без внешних callers (ждёт pricing).
- **Usage:** `stats-collector` (http-server) буферизует запросы/AI/байты и раз в 60с вызывает `recordUsage` с `$context: billing` → агрегация по дням в `usage.json`.
- **Хранение:** `wallet.json`, `usage.json`, `*.tx.json`, `*.pending.json` — в ADMIN `$work` класса; чтение/запись через `billing-store` → `save_file`.

## Из чего это состоит

- [`$billing/class.js`](/SYS/Billing/$billing/class.js/~/handlers/pages/form/) — item: label «Биллинг», icon wallet
- [`$billing/$folder/$class/$billing/class.js`](/SYS/Billing/$billing/$folder/$class/$billing/class.js/~/handlers/pages/form/) — distributed тип: label «Биллинг»
- **Методы** (`$billing/$folder/$class/$billing/methods/<name>/$method/class.js`):
  - `getBalance` — баланс/валюта (root ADMIN)
  - `topUp` — создание платежа ЮKassa + pending (root ADMIN)
  - `creditWallet` — зачисление по webhook, всегда `getPayment` (system only)
  - `debit` — списание по usage/services (system only, без callers)
  - `getTransactions` — последние 100 tx (root ADMIN)
  - `getUsageStats` — агрегированные метрики (root ADMIN)
  - `recordUsage` — инкремент дневного usage (system only)
- [`handlers/pages/dashboard/$handler/class.js`](/SYS/Billing/$billing/handlers/pages/dashboard/$handler/class.js/~/handlers/pages/form/) — UI: баланс, метрики, кнопка «Пополнить»

## В каком это состоянии

- ✅ topUp + creditWallet (ЮKassa, с remote verify)
- ✅ recordUsage + getUsageStats (stats-collector с `$context`)
- ✅ dashboard UI
- 🔧 `debit` реализован, не подключён (ждёт pricing)
- 🔧 tx/wallet — временный ledger, миграция в `register/` позже

## Дальнейшие планы

- Подключить `debit` в `approveProposal` (Offerings) и `stats-collector` после определения тарифов.
- Мост tx → `register/` (двойная запись) после готовности `register/`.
- Идемпотентность webhook подтверждена; рассмотреть ретраи при временных сбоях ЮKassa.
