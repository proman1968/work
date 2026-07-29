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

`baseDomain` / DNS — настройки сервиса, в заказ не пишутся.

## 4. Из чего это состоит

- `methods/submitOrder` — запись `pass.order` (клиентский fetch с витрины)
- `$service/class.js` — серверные методы экземпляра
- Form `orders` (наследование с ArgoCD) — таблица заявок

## 5. В каком это состоянии

- ✅ Модель product + domainName
- ✅ Методы на экземпляре PaaS
- ❌ Полный Helm/DNS pipeline
