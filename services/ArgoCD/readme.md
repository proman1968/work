# ArgoCD

## Что это

Точка подключения к Argo CD — серверу непрерывной доставки приложений в Kubernetes. Базовый класс для сервисов, работающих через Argo CD API (наследуется PaaS и другими).

## Зачем это нужно

Унифицирует подключение к Argo CD: параметры соединения и шаблон Application описываются один раз в STATIC, token хранится в `#secret`, а заявки клиентов обрабатываются серверными методами. PaaS и иные производные сервисы наследуют поведение через `~`.

## Как это работает

### Подключение и token

- Параметры подключения и шаблон Application — поля `METADATA.STATIC` (`url`, `project`, `repoURL`, `chart`, `targetRevision`, `destinationServer`, `destinationNamespace`, `syncPrune`, `syncSelfHeal`, `insecure`).
- Token хранится только в `#secret/argocd.json` (`{ token }`), читается/пишется через `read_secret`/`save_secret` (ADMIN). На клиент отдаётся лишь признак `tokenSet` (метод `tokenStatus`), значение никогда не уходит в браузер.
- Представление `settings` — редактор STATIC + отдельный блок token (password + «задан / не задан»).

### Заявки

Заявка — запись `pass.order` в history текущего сервиса. Каждое сохранение `submitOrder` создаёт снимок в `.pass.order/history/<date>/`. Серверные методы правят JSON конкретного снимка напрямую (`fsp.writeFile`), без нового `save_file`.

Статусы (в поле `status` записи):

| `status`     | UI            |
|--------------|---------------|
| `''` (нет)   | в обработке   |
| `rejected`   | отвергнута    |
| `in_progress`| в работе      |
| `completed`  | завершена     |

Поток принятия заявки: `acceptOrder` → пометка `in_progress` → `checkDnsName` (резолв через `ns1.odant.org`: IP без ошибки ⇒ имя занято) → `createApplication` (POST `{url}/api/v1/applications`, Bearer из `#secret`). Проверка завершения развёртывания пока не реализована — завершение ручное (`completeOrder`).

### Методы (в `class.js`, по канону Weather/SearXNG)

- `tokenStatus` / `saveToken` — управление token.
- `checkDnsName` — проверка свободности имени.
- `createApplication` — POST заявки в Argo CD API (с `insecure`-агентом).
- `listOrders` — список заявок из history.
- `acceptOrder` / `rejectOrder` / `completeOrder` — смена статусов с правкой записи в history.

## Из чего это состоит

- [`$service/$folder/$class/$service/class.js`]($service/$folder/$class/$service/class.js) — базовый класс `$service`: STATIC, статусы, все серверные методы.
- [`$service/$folder/$class/$service/handlers/pages/form/settings/$handler/class.js`]($service/$folder/$class/$service/handlers/pages/form/settings/$handler/class.js) — представление настройки подключения.
- [`$service/$folder/$class/$service/handlers/pages/form/orders/$handler/class.js`]($service/$folder/$class/$service/handlers/pages/form/orders/$handler/class.js) — таблица заявок с контролами принять/отклонить/завершить.
- [`PaaS/$service/...`] — производный сервис PaaS (`/SERVICES/ArgoCD/PaaS`): наследует STATIC и методы, добавляет `baseDomain` и тарифы; значения подключения живут в самом сервисе (отдельный `prod` не используется).

## В каком это состоянии

- ✅ STATIC подключения и шаблон Application.
- ✅ Token в `#secret`, признак `tokenSet` на клиенте.
- ✅ Методы `tokenStatus`/`saveToken`, `checkDnsName`, `createApplication`.
- ✅ Таблица заявок: список, статусы, контролы с подтверждением.
- ✅ `acceptOrder`/`rejectOrder`/`completeOrder` с правкой history.
- 🔧 Проверка завершения развёртывания (polling статуса Application) — не реализована.
- 🔧 Создание инстанса `$paas`/`NODES` после успешного деплоя — вне этого слоя.

## Дальнейшие планы

- Polling статуса Application в ArgoCD для авто-`completed`.
- Расширение `checkDnsName` под другие типы записей.
- Общий secret-тип поля в `form/editor` для платформы.
