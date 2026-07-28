# MARKET — витрина

## 1. Что это

`MARKET` — основная витрина WORK: категории товаров/услуг/подписок. Клиент выбирает позицию и оставляет заявку (`.bid`).

## 2. Зачем это нужно

Единая точка покупки внутри платформы. Категории — `$class`; товары — файлы `.product` в `work/product/` категории; заявка — файл `$bid`. Карточка товара и форма заказа — разные сущности. Продукт — данные из `.product`, без хардкодных списков тарифов.

## 3. Как это работает

1. Сайт `MARKET` (shell `site` из `~`) — меню категорий.
2. Категория `PAAS`: handlers под `$class/` — `site/main` с карточками товаров.
3. Товары — файлы `*.product` (`label`, `price`, `description`) в `work/product/` зоны роли. Main: `~//product`, только `status === published`.
4. Управление — form-view `products`: таблица, add/delete с ролью form → `save_file` / `delete` на класс категории.
5. Клик по карточке → модалка: описание + поле **«Имя домена»** (`domainName`) + «Заказать».
6. «Заказать» → auth при необходимости → `{uid}.bid` на `/MARKET/PAAS` (`status`, `product` + `$Link`, `input`) → всегда `submitOrder` на `/SERVICES/ArgoCD/PaaS` (`pass.order`: `status`, `$Link` → `.bid`, `product`, `input`).

## 4. Из чего это состоит

- `$class/class.js` — витрина «Магазин»
- `PAAS/$class/` — категория + `handlers/pages/site` (shell + main)
- `PAAS/$class/handlers/pages/form/products/` — вкладка «Продукты»
- `PAAS/$class/work/product/*.product` — товары
- Тип `$product` — [`$server/$folder/$file/$product/`](/$server/$folder/$file/$product/readme.md/~/handlers/pages/form/) (карточка)
- Тип `$bid` — [`$server/$folder/$file/$bid/`](/$server/$folder/$file/$bid/readme.md/~/handlers/pages/form/) (заявка)

## 5. В каком это состоянии

- ✅ `$product` — нейтральная карточка (название, стоимость, описание)
- ✅ PAAS form/products + витрина; заказ через `.bid` + `pass.order`
- ❌ Биллинг / DNS fqdn в теле заявки (baseDomain — настройка сервиса)

## 6. Дальнейшие планы

- Другие категории витрины
- Редактирование существующего `.product`
