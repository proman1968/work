# ArgoCD PaaS — заявки

## 1. Что это

Сервис `/SERVICES/ArgoCD/PaaS`: приём заявок витрины (`submitOrder` → `pass.order`), список/accept/reject и `provision` → `$paas`.

## 2. Зачем это нужно

Отделить исполнение PaaS от витрины MARKET: заявка клиента — `.bid`; очередь сервиса — снимки `pass.order` в history.

## 3. Как это работает

1. Клиент сохраняет `.bid`, затем `WORK.fetch(..., 'submitOrder', {}, { $Link, product, input })`.
2. `submitOrder` пишет `pass.order` в `$service/order/` (подпапка по расширению).
3. Серверные методы — в [`$service/class.js`](/SERVICES/ArgoCD/PaaS/$service/class.js/~/handlers/pages/form/) экземпляра (канон Weather): `listOrders`, `acceptOrder`, `rejectOrder`, `completeOrder`, `provision`.
4. `listOrders` читает `$service/order/.pass.order/history/`.
5. `acceptOrder` → `this.provision` → `/PAAS/{domainName}` + `createApplication`.

Настройки сервиса — top-level **`FIELDS`** (канон как у `$product`/`$bid`): базовый ArgoCD + слой PaaS (`baseDomain`, `checkDnsUrl`) мержатся по `id`. Значения — корневые props `class.js`. Form **settings** строит UI по `FIELDS`; token — в `#secret`. `baseDomain` / DNS в заказ не пишутся.

## 4. Из чего это состоит

- `methods/submitOrder` — запись `pass.order` (клиентский fetch с витрины)
- `$folder/$class/.../class.js` — схема `FIELDS` PaaS (`baseDomain`, `checkDnsUrl`)
- `$service/class.js` — значения настроек + серверные методы экземпляра
- Form `orders` / `settings` (наследование с ArgoCD)

## 5. В каком это состоянии

- ✅ Модель product + domainName
- ✅ Методы на экземпляре PaaS
- ✅ Настройки через FIELDS (не METADATA.STATIC)
- ❌ Полный Helm/DNS pipeline
