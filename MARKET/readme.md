# MARKET — витрина

## 1. Что это

`MARKET` — основная витрина WORK: категории товаров/услуг/подписок. Клиент выбирает позицию и оставляет заявку (`.bid`).

## 2. Зачем это нужно

Единая точка покупки внутри платформы. Категории — `$class`; товары — файлы `.product` в `work/product/` категории; заявка — файл `$bid`.

## 3. Как это работает

1. Сайт `MARKET` (shell `site` из `~`) — меню категорий.
2. Категория `PAAS`: handlers под `$class/` (чтобы `~/handlers` видел override) — `site/main` с карточками товаров.
3. Товары — файлы `*.product` в `work/product/` зоны роли (USER → `meta_folder/work/product/`). Main получает список через `~//product` и грузит актуальные версии файлов.
4. Клик по карточке → `WORK.showModal` с панелью заказа (описание + форма из `orderForm` + «Заказать»).
5. «Заказать» → auth при необходимости → `{uid}.bid` сохраняется на ближайший `$class` категории (`/MARKET/PAAS`) по роли покупателя. Повторный заказ перезаписывает файл; предыдущие версии — в `history` и `data.logs`.

## 4. Из чего это состоит

- `$class/class.js` — витрина «Магазин»
- `PAAS/$class/` — категория + `handlers/pages/site` (shell `{}` + main: карточки/модалка)
- `PAAS/$class/work/product/*.product` — товары (тарифные планы): `старт.product`, `бизнес.product`, `предприятие.product`
- Тип `$product` — [`$server/$folder/$file/$product/`]($server/$folder/$file/$product/) (схема `FIELDS`, шаблон)
- Тип `$bid` — [`$server/$folder/$file/$bid/`]($server/$folder/$file/$bid/) (схема заявки, preview)

## 5. В каком это состоянии

- ✅ Тип `$product` (схема + шаблон)
- ✅ PAAS карточки → модалка → `.bid` через client `save_file` на класс категории
- ❌ Provision / биллинг / связь с `$order`

## 6. Дальнейшие планы

- Другие категории витрины
- Наследование `orderForm` с категории
- Подключение исполнения заявки (вне MARKET)
- Синхронизация тарифов с корневым `/PAAS` landing
